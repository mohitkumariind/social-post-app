'use client';

import Navbar from '@/components/admin/Navbar';
import Sidebar from '@/components/admin/Sidebar';
import { usePathname } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/admin': 'Dashboard',
  '/admin/events': 'Events',
  '/admin/parties': 'Parties',
  '/admin/geography': 'Geography',
  '/admin/users': 'Users',
  '/admin/notifications': 'Notification Broadcast Center',
};

function getTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/admin/events')) return 'Events';
  if (pathname.startsWith('/admin/notifications')) return 'Notification Broadcast Center';
  return 'Admin';
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const title = getTitle(pathname);

  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <div className="ml-64 flex flex-1 flex-col">
        <Navbar title={title} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
