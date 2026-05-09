import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import {
  RbacError,
  requireStandardRbacContext,
} from '@/lib/rbac/require';
import { SECURITY_LIMITS, envLimit } from '@/lib/security-limits';

const ALLOWED_BUCKETS = new Set(['post-images', 'user-frames']);

function assertSafePath(path: string): string {
  const p = path.trim();
  if (!p || p.includes('..') || p.startsWith('/')) {
    throw new Error('Invalid path');
  }
  if (!p.startsWith('public/')) {
    throw new Error('Path must start with public/');
  }
  return p;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: auth.status }
    );
  }
  try {
    requireStandardRbacContext(auth, ['admin', 'moderator', 'campaign_manager']);
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const bucket = String(form.get('bucket') ?? '');
  const pathRaw = String(form.get('path') ?? '');
  const file = form.get('file');

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }
  if (auth.role === 'moderator') {
    if (auth.assigned_state_ids.length === 0) {
      return NextResponse.json({ error: 'Moderator is missing assigned_state_ids' }, { status: 403 });
    }
    if (bucket !== 'user-frames') {
      return NextResponse.json({ error: 'Moderators can only upload user frames' }, { status: 403 });
    }
  }
  if (auth.role === 'campaign_manager') {
    if (bucket !== 'post-images') {
      return NextResponse.json({ error: 'campaign_manager can only upload post images' }, { status: 403 });
    }
  }

  let path: string;
  try {
    path = assertSafePath(pathRaw);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Invalid path' },
      { status: 400 }
    );
  }

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }
  const maxUploadBytes = envLimit('STORAGE_UPLOAD_MAX_BYTES', SECURITY_LIMITS.storageUploadMaxBytes, 1024, 50 * 1024 * 1024);
  if (file.size > maxUploadBytes) {
    return NextResponse.json({ error: `File too large. Max ${maxUploadBytes} bytes` }, { status: 400 });
  }

  if (auth.role === 'moderator') {
    // Enforce: public/<userId>/... and userId must belong to the moderator's assigned state.
    const parts = path.split('/').filter(Boolean); // e.g. ["public","<userId>",...]
    const userId = parts.length >= 2 && parts[0] === 'public' ? parts[1] : '';
    if (!userId) {
      return NextResponse.json({ error: 'Invalid path for moderator uploads' }, { status: 400 });
    }
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('id, assigned_state_ids')
      .eq('id', userId)
      .maybeSingle();
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    const ok = canAccessResource(
      {
        id: auth.user.id,
        role: auth.role,
        assigned_state_ids: auth.assigned_state_ids,
        assigned_group_ids: auth.assigned_group_ids,
      },
      { state_ids: (prof as any)?.assigned_state_ids },
      { resourceType: 'profiles', audit: { resourceType: 'profiles', action: 'storage.upload.scope.validate' } }
    );
    if (!ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  if (auth.role === 'campaign_manager') {
    // Enforce: public/events/<eventId>/... and event must belong to campaign_manager.
    const parts = path.split('/').filter(Boolean); // e.g. ["public","events","<eventId>",...]
    const eventId = parts.length >= 3 && parts[0] === 'public' && parts[1] === 'events' ? parts[2] : '';
    if (!eventId) {
      return NextResponse.json({ error: 'Invalid path for campaign_manager uploads' }, { status: 400 });
    }
    const { data: ev, error: evErr } = await admin
      .from('events')
      .select('id, created_by')
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
    const owner = String((ev as any)?.created_by ?? '').trim();
    if (!owner || owner !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || 'application/octet-stream';

  const { error: uploadErr } = await admin.storage.from(bucket).upload(path, buf, {
    contentType,
    upsert: true,
  });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: urlData } = admin.storage.from(bucket).getPublicUrl(path);
  return NextResponse.json(
    { publicUrl: urlData.publicUrl, path, bucket },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
