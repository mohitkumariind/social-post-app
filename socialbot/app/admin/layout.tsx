'use client';

import { usePathname } from 'next/navigation';
import Navbar from '@/components/admin/Navbar';
import Sidebar from '@/components/admin/Sidebar';

const PAGE_TITLES: Record<string, string> = {
  '/admin': 'Dashboard',
  '/admin/posts': 'Posts',
  '/admin/posts/new': 'New Post',
  '/admin/parties': 'Parties',
  '/admin/geography': 'Geography',
  '/admin/frames': 'Frames',
  '/admin/users': 'Users',
};

function getTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/admin/posts/new')) return 'New Post';
  if (pathname.startsWith('/admin/posts')) return 'Posts';
  return 'Admin';
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const title = getTitle(pathname);

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
