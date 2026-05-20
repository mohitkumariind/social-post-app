import { redirect } from 'next/navigation';

/** Legacy URL — event create + upload live on /admin/events for all roles. */
export default function EventCreatePage() {
  redirect('/admin/events');
}
