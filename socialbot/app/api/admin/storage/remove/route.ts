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

  const { error } = await admin.storage.from(bucket).remove(paths);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, removed: paths.length });
}
