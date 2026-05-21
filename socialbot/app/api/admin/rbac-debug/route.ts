import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { canAccessDashboardModule, toDashboardActor } from '@/lib/rbac/dashboard-access';
import { evaluateRbacForUser, listDebugUsers } from '@/lib/rbac/rbac-debug-eval';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RbacError, requireRole } from '@/lib/rbac/require';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const session = await validateAdminSession(supabase);
  if (!session.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: session.status });
  }
  try {
    requireRole(session, ['admin', 'super_admin']);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const actor = toDashboardActor(session);
  if (!canAccessDashboardModule(actor, 'rbac_debug')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY required' }, { status: 503 });
  }

  const userId = (request.nextUrl.searchParams.get('user_id') ?? '').trim();
  if (!userId) {
    const users = await listDebugUsers(admin, 80);
    return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const users = await listDebugUsers(admin, 200);
  const target = users.find((u) => u.id === userId);
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const evaluation = await evaluateRbacForUser(admin, target, 12);
  return NextResponse.json({ evaluation }, { headers: { 'Cache-Control': 'no-store' } });
}
