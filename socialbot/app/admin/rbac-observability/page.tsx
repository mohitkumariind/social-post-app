import { redirect } from 'next/navigation';
import { validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import RbacObservabilityClient from '@/app/admin/rbac-observability/RbacObservabilityClient';

export default async function RbacObservabilityPage() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);

  if (!auth.ok) redirect('/admin/login');
  if (auth.role !== 'admin') redirect('/admin');

  return <RbacObservabilityClient />;
}

