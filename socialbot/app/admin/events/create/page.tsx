import { redirect } from 'next/navigation';
import { isEditor, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import EventCreateClient from './EventCreateClient';

export default async function EventCreatePage() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) redirect('/admin/login');
  if (!isEditor(auth)) redirect('/admin/events');
  return <EventCreateClient />;
}
