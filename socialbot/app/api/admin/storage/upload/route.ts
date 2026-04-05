import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
