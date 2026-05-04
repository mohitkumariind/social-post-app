import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type Body = { ids?: string[]; group_tags?: string[] };

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x).trim()).filter(Boolean) : [];
  const group_tags = Array.isArray(body.group_tags)
    ? body.group_tags.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (ids.length === 0) return NextResponse.json({ error: 'Missing ids' }, { status: 400 });

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const { error } = await db.from('profiles').update({ group_tags }).in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: ids.length }, { headers: { 'Cache-Control': 'no-store' } });
}

