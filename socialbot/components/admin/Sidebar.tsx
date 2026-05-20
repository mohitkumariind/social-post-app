'use client';

import {
  LayoutDashboard,
  Calendar,
  Building2,
  Users,
  Bell,
  Tags,
  ListOrdered,
  ShieldAlert,
  BarChart3,
  LineChart,
  Image as ImageIcon,
  Share2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/events', label: 'Events', icon: Calendar },
  { href: '/admin/parties', label: 'Parties', icon: Building2 },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/leaderboard', label: 'Leaderboard', icon: BarChart3 },
  { href: '/admin/analytics', label: 'Analytics', icon: LineChart },
  { href: '/admin/banner-manager', label: 'Banner Manager', icon: ImageIcon },
  { href: '/admin/groups', label: 'Group Management', icon: Tags },
  { href: '/admin/notifications', label: 'Broadcast', icon: Bell },
  { href: '/admin/twitter-campaign', label: 'Twitter Campaign', icon: Share2 },
  { href: '/admin/activity-center', label: 'Activity Center', icon: ListOrdered },
  { href: '/admin/rbac-observability', label: 'RBAC Observability', icon: ShieldAlert },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/viewer', { credentials: 'same-origin' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => ({}))) as { role?: string | null };
        if (cancelled) return;
        setRole(typeof d.role === 'string' ? d.role : null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleNavItems = useMemo(() => {
    const r = role?.toLowerCase() ?? '';
    if (r === 'moderator') {
      // Moderator: Dashboard, Users, Events, Notifications, Twitter Campaign, Groups (NO Activity Center)
      return navItems.filter(
        (i) =>
          i.href !== '/admin/parties' &&
          i.href !== '/admin/banner-manager' &&
          i.href !== '/admin/activity-center' &&
          i.href !== '/admin/rbac-observability'
      );
    }
    if (r === 'campaign_manager') {
      // Campaign Manager: Dashboard, Users, Events, Notifications, Groups (NO Activity Center, NO Twitter Campaign)
      return navItems.filter(
        (i) =>
          i.href === '/admin' ||
          i.href === '/admin/users' ||
          i.href === '/admin/leaderboard' ||
          i.href === '/admin/analytics' ||
          i.href === '/admin/events' ||
          i.href === '/admin/groups' ||
          i.href === '/admin/notifications'
      );
    }
    // Admin / super_admin: full nav. Safe-by-default: hide restricted items until role is known.
    if (r === 'admin' || r === 'super_admin') return navItems;
    return navItems.filter(
      (i) =>
        i.href !== '/admin/banner-manager' &&
        i.href !== '/admin/activity-center' &&
        i.href !== '/admin/rbac-observability' &&
        i.href !== '/admin/twitter-campaign'
    );
  }, [role]);

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-16 items-center gap-3 border-b border-zinc-800 px-6">
        <Image
          src="/social-post-icon.png"
          alt="Social Post"
          width={36}
          height={36}
          className="rounded-lg shrink-0"
        />
        <span className="text-xl font-bold tracking-tight text-white">
          Social Post
        </span>
      </div>
      <nav className="flex flex-col gap-1 p-4">
        {visibleNavItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
