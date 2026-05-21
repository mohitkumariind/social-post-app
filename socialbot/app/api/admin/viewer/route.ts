import { NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getAllowedModules,
  getDashboardFilterVisibility,
  toDashboardActor,
  type DashboardModuleId,
} from '@/lib/rbac/dashboard-access';
import { ALL_DASHBOARD_MODULE_IDS } from '@/lib/rbac/dashboard-module-ids';
import { RbacError, requireRole } from '@/lib/rbac/require';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  try {
    requireRole(auth, ['admin', 'super_admin', 'moderator', 'campaign_manager', 'editor']);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const actor = toDashboardActor(auth);
  const filters = getDashboardFilterVisibility(actor);
  const allowed_modules = getAllowedModules(actor);
  const hidden_modules = ALL_DASHBOARD_MODULE_IDS.filter(
    (m) => !allowed_modules.includes(m)
  ) as DashboardModuleId[];

  return NextResponse.json(
    {
      role: auth.role,
      assigned_state_ids: auth.assigned_state_ids,
      assigned_group_ids: auth.assigned_group_ids,
      assigned_party_ids: auth.assigned_party_ids,
      dashboard_access: {
        allowed_modules,
        hidden_modules,
        denied_actions: [] as string[],
        can_use_global_filters: filters.canUseGlobalFilters,
        filter_visibility: filters,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

