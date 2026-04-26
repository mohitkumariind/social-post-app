import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }

  const userId = (request.nextUrl.searchParams.get('user_id') ?? '').trim();
  const searchQuery = (request.nextUrl.searchParams.get('search_query') ?? '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const base = () =>
    db
      .from('user_frames')
      // `file_name` is optional across projects; keep response typing loose.
      .select('id,url,created_at,file_name')
      .eq('user_id', userId)
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

