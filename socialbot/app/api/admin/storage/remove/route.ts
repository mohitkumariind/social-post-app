import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, isCampaignManager, isModerator, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import {
  RbacError,
  requireStandardRbacContext,
} from '@/lib/rbac/require';
import { SECURITY_LIMITS } from '@/lib/security-limits';

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const b = body as { bucket?: string; paths?: unknown };
  const bucket = String(b.bucket ?? '');
  const pathsRaw = Array.isArray(b.paths) ? b.paths : [];

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }
  if (isModerator(auth)) {
    if (auth.assigned_state_ids.length === 0) {
      return NextResponse.json({ error: 'Moderator is missing assigned_state_ids' }, { status: 403 });
    }
    if (bucket !== 'user-frames') {
      return NextResponse.json({ error: 'Moderators can only remove user frames' }, { status: 403 });
    }
  }
  if (isCampaignManager(auth)) {
    if (bucket !== 'post-images') {
      return NextResponse.json({ error: 'campaign_manager can only remove post images' }, { status: 403 });
    }
  }

  const paths: string[] = [];
  for (const raw of pathsRaw) {
    try {
      paths.push(assertSafePath(String(raw)));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid path in list' },
        { status: 400 }
      );
    }
  }

  if (paths.length === 0) {
    return NextResponse.json({ ok: true, removed: 0 });
  }
  if (paths.length > SECURITY_LIMITS.storageRemovePaths) {
    return NextResponse.json({ error: `Too many paths. Max ${SECURITY_LIMITS.storageRemovePaths}` }, { status: 400 });
  }

  if (isModerator(auth)) {
    // All paths must be under public/<userId>/ and user must belong to assigned state.
    const userIds = new Set<string>();
    for (const p of paths) {
      const parts = p.split('/').filter(Boolean);
      const uid = parts.length >= 2 && parts[0] === 'public' ? parts[1] : '';
      if (!uid) return NextResponse.json({ error: 'Invalid path for moderator remove' }, { status: 400 });
      userIds.add(uid);
      if (userIds.size > 20) return NextResponse.json({ error: 'Too many user paths' }, { status: 400 });
    }
    for (const uid of userIds) {
      const { data: prof, error: profErr } = await admin
        .from('profiles')
        .select('id, assigned_state_ids')
        .eq('id', uid)
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
        { resourceType: 'profiles', audit: { resourceType: 'profiles', action: 'storage.remove.scope.validate' } }
      );
      if (!ok) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  if (isCampaignManager(auth)) {
    // All paths must be under public/events/<eventId>/ and event must be owned by campaign_manager.
    const eventIds = new Set<string>();
    for (const p of paths) {
      const parts = p.split('/').filter(Boolean);
      const eid = parts.length >= 3 && parts[0] === 'public' && parts[1] === 'events' ? parts[2] : '';
      if (!eid) return NextResponse.json({ error: 'Invalid path for campaign_manager remove' }, { status: 400 });
      eventIds.add(eid);
      if (eventIds.size > 20) return NextResponse.json({ error: 'Too many event paths' }, { status: 400 });
    }
    for (const eid of eventIds) {
      const { data: ev, error: evErr } = await admin
        .from('events')
        .select('id, created_by')
        .eq('id', eid)
        .maybeSingle();
      if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
      const owner = String((ev as any)?.created_by ?? '').trim();
      if (!owner || owner !== auth.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  const { error } = await admin.storage.from(bucket).remove(paths);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, removed: paths.length });
}
