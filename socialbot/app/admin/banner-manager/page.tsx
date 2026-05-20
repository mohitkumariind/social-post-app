import { redirect } from 'next/navigation';
import { validateAdminSession } from '@/lib/admin-gate';
import { canAccessBannerManager } from '@/lib/permissions';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import BannerManagerClient from './BannerManagerClient';

export default async function BannerManagerPage() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);

  if (!auth.ok) redirect('/admin/login');
  if (!canAccessBannerManager(auth.role)) redirect('/admin');

  return <BannerManagerClient />;
}
