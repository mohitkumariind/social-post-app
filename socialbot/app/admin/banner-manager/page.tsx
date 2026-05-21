import { redirect } from 'next/navigation';
import { validateAdminSession } from '@/lib/admin-gate';
import { canAccessDashboardModule, toDashboardActor } from '@/lib/rbac/dashboard-access';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import BannerManagerClient from './BannerManagerClient';

export default async function BannerManagerPage() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);

  if (!auth.ok) redirect('/admin/login');
  if (!canAccessDashboardModule(toDashboardActor(auth), 'banner_manager')) redirect('/admin');

  return <BannerManagerClient />;
}
