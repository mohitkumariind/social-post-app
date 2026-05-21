import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, isCampaignManager, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery, resolveAllowedProfileIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';
import { isElevatedDashboardRole } from '@/lib/rbac/dashboard-permissions';
import { RbacError, requireCampaignManagerHasAssignedGroups, requireRole } from '@/lib/rbac/require';
import { SECURITY_LIMITS } from '@/lib/security-limits';

type Body = { ids?: string[]; group_tags?: string[]; /** Only if you intentionally want to clear tags for all selected users. */ allowClear?: boolean };

const NO_SERVICE_ROLE =
  'Bulk tag assign requires SUPABASE_SERVICE_ROLE_KEY on the server; otherwise RLS may block updates to other users and group_tags stays null.';

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  try {
    requireRole(auth, ['admin', 'campaign_manager']);
    requireCampaignManagerHasAssignedGroups(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  if (ids.length > SECURITY_LIMITS.bulkProfileIds) {
    return NextResponse.json({ error: `Too many ids. Max ${SECURITY_LIMITS.bulkProfileIds}` }, { status: 400 });
  }
  if (group_tags.length > SECURITY_LIMITS.bulkGroupTags) {
    return NextResponse.json({ error: `Too many group_tags. Max ${SECURITY_LIMITS.bulkGroupTags}` }, { status: 400 });
  }

  if (group_tags.length === 0 && !body.allowClear) {
    return NextResponse.json(
      {
        error:
          'group_tags is empty. Refusing to set all selected users to [] (prevents accidental wipe). Add at least one tag, or pass allowClear: true if you really want to clear.',
      },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }

  const scopedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  } as any;

  const allowed_profile_ids =
    isCampaignManager(auth) ? await resolveAllowedProfileIdsForCampaignManager(admin as any, auth.assigned_group_ids) : null;

  if (isElevatedDashboardRole(auth.role)) {
    const decision = canPerformMutation(
      scopedUser,
      'profiles.bulk_tags',
      null,
      { ids, group_tags },
      { resourceType: 'profiles', resourceName: 'bulk-tags' }
    );
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
  } else if (isCampaignManager(auth)) {
    // Strict: ALL requested ids must be within assigned groups (deny partial writes).
    const q = buildScopedQuery(
      scopedUser,
      admin.from('profiles').select('id').in('id', ids) as any,
      'profiles',
      { allowed_profile_ids: Array.isArray(allowed_profile_ids) ? allowed_profile_ids : undefined }
    );
    const { data: allowedRows, error: allowErr } = await q;
    if (allowErr) return NextResponse.json({ error: allowErr.message }, { status: 500 });
    const allowed = new Set((allowedRows ?? []).map((r: any) => String(r.id ?? '').trim()).filter(Boolean));
    const outside = ids.filter((id) => !allowed.has(id));
    if (outside.length > 0) {
      // Ensure denied attempts are audited via scoped write engine.
      canPerformMutation(
        scopedUser,
        'profiles.bulk_tags',
        { group_id: '__outside__' } as any,
        { ids, group_tags } as any,
        { resourceType: 'profiles', resourceName: 'bulk-tags' }
      );
      return NextResponse.json({ error: 'Forbidden: includes users outside assigned_group_ids' }, { status: 403 });
    }
    // Record allowed attempt for consistent auditing. (Scope already validated above.)
    {
      const decision = canPerformMutation(
        scopedUser,
        'profiles.bulk_tags',
        { group_ids: auth.assigned_group_ids } as any,
        { ids, group_tags } as any,
        { resourceType: 'profiles', resourceName: 'bulk-tags' }
      );
      if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
    }
  }

  /** Column name must match Supabase `profiles.group_tags` (TEXT[]). */
  const { data, error } = await admin.from('profiles').update({ group_tags }).in('id', ids).select('id, group_tags');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void logAdminAction({
    actor_user_id: auth.user.id,
    actor_role: auth.role,
    action_type: 'profiles.bulk_tags',
    resource_type: 'profiles',
    resource_id: null,
    resource_name: 'bulk-tags',
    previous_data: null,
    new_data: { ids_count: ids.length, group_tags },
    metadata: { ids: ids.slice(0, 200) },
    affected_users_count: ids.length,
    severity: 'info',
    undoable: false,
    scope_group_ids: isCampaignManager(auth) ? (auth.assigned_group_ids ?? []) : [],
    scope_user_ids: ids,
  });

  return NextResponse.json({ ok: true, updated: ids.length }, { headers: { 'Cache-Control': 'no-store' } });
}
