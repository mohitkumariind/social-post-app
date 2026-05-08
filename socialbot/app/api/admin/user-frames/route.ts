import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return NextResponse.json({ error: 'Moderator is missing assigned_state_ids' }, { status: 403 });
  }

  const userId = (request.nextUrl.searchParams.get('user_id') ?? '').trim();
  const searchQuery = (request.nextUrl.searchParams.get('search_query') ?? '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  // Moderators may only access frames for users in their assigned states.
  if (auth.role === 'moderator') {
    const { data: prof, error: profErr } = await db
      .from('profiles')
      .select('id, assigned_state_ids')
      .eq('id', userId)
      .maybeSingle();
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    const idsArr = Array.isArray((prof as any)?.assigned_state_ids) ? (prof as any).assigned_state_ids : [];
    const viewerStates = auth.assigned_state_ids.map(Number);
    const ok = idsArr.some((x: any) => viewerStates.includes(Number(x)));
    if (!ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const base = () =>
    db
      .from('user_frames')
      // `file_name` is optional across projects; keep response typing loose.
      .select('id,url,created_at,file_name')
      .eq('user_id', userId)
      .order('file_name', { ascending: true })
      .order('created_at', { ascending: false }) as any;

  const baseWithoutFileName = () =>
    db
      .from('user_frames')
      .select('id,url,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }) as any;

  const isMissingColumnErr = (err: { message?: string } | null | undefined, columnName: string) => {
    const msg = String(err?.message ?? '').toLowerCase();
    return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
  };

  // If file_name column doesn't exist in this project, fall back to URL search.
  if (!searchQuery) {
    let { data, error } = await base();
    if (error && isMissingColumnErr(error, 'file_name')) {
      ({ data, error } = await baseWithoutFileName());
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ frames: data ?? [], usedServiceRole: !!admin }, { headers: { 'Cache-Control': 'no-store' } });
  }

  let res: any = await base().ilike('file_name', `%${searchQuery}%`);
  if (res.error) {
    if (isMissingColumnErr(res.error, 'file_name')) {
      res = (await db
        .from('user_frames')
        .select('id,url,created_at')
        .eq('user_id', userId)
        .ilike('url', `%${searchQuery}%`)
        .order('created_at', { ascending: false })) as any;
    }
  }

  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json({ frames: res.data ?? [], usedServiceRole: !!admin }, { headers: { 'Cache-Control': 'no-store' } });
}

