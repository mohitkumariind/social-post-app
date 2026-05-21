import { redirect } from 'next/navigation';
import { validateAdminSession } from '@/lib/admin-gate';
import { canAccessDashboardModule, toDashboardActor } from '@/lib/rbac/dashboard-access';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import RbacDebugClient from './RbacDebugClient';

export default async function RbacDebugPage() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) redirect('/admin/login');
  if (!canAccessDashboardModule(toDashboardActor(auth), 'rbac_debug')) redirect('/admin');

  return <RbacDebugClient />;
}
