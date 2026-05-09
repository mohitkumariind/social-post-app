import { NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery, resolveAllowedProfileIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
import { RbacError, requireRole } from '@/lib/rbac/require';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  try {
    requireRole(auth, ['admin', 'campaign_manager']);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

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

  // Best-effort: pull tags from profiles and flatten unique values.
  const pageSize = 1000;
  const maxRows = 10000;
  const set = new Set<string>();
  let from = 0;
  for (;;) {
    let q: any = db.from('profiles').select('group_tags').order('id', { ascending: true }).range(from, from + pageSize - 1);
    q = buildScopedQuery(scopedUser, q, 'profiles', { allowed_profile_ids: Array.isArray(allowed_profile_ids) ? allowed_profile_ids : undefined });
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const tags = row?.group_tags;
      if (Array.isArray(tags)) {
        for (const t of tags) {
          const s = String(t ?? '').trim();
          if (s) set.add(s);
        }
      } else if (typeof tags === 'string') {
        const s = tags.trim();
        if (s) set.add(s);
      }
    }

    from += rows.length;
    if (rows.length < pageSize) break;
    if (from >= maxRows) break;
  }

  return NextResponse.json({ tags: Array.from(set).sort() }, { headers: { 'Cache-Control': 'no-store' } });
}

