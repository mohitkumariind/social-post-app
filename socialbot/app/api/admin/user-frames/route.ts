import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery, resolveAllowedProfileIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
import { RbacError, requireModeratorHasAssignedStates, requireRole } from '@/lib/rbac/require';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const userId = (request.nextUrl.searchParams.get('user_id') ?? '').trim();
  const searchQuery = (request.nextUrl.searchParams.get('search_query') ?? '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  // Enforce scope BEFORE querying frames.
  const scopedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  } as any;

  const allowed_profile_ids =
    auth.role === 'campaign_manager' && admin
      ? await resolveAllowedProfileIdsForCampaignManager(admin as any, auth.assigned_group_ids)
      : null;

  {
    const profQuery = buildScopedQuery(
      scopedUser,
      db.from('profiles').select('id').eq('id', userId).limit(1) as any,
      'profiles',
      { allowed_profile_ids: Array.isArray(allowed_profile_ids) ? allowed_profile_ids : undefined }
    );
    const { data: prof, error: profErr } = await profQuery.maybeSingle();
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

