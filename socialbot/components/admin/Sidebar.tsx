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
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useMemo } from 'react';
import { useDashboardAccess } from '@/lib/hooks/useDashboardAccess';
import { getVisibleSidebarItems, type DashboardModuleId } from '@/lib/rbac/dashboard-access';

const MODULE_ICONS: Record<DashboardModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  events: Calendar,
  parties: Building2,
  users: Users,
  leaderboard: BarChart3,
  analytics: LineChart,
  banner_manager: ImageIcon,
  group_management: Tags,
  broadcast: Bell,
  twitter_campaign: Share2,
  activity_center: ListOrdered,
  rbac_observability: ShieldAlert,
  rbac_debug: ShieldAlert,
};

export default function Sidebar() {
  const pathname = usePathname();
  const { access } = useDashboardAccess();

  const visibleNavItems = useMemo(() => {
    if (!access?.actor) return [];
    return getVisibleSidebarItems(access.actor).map((item) => ({
      ...item,
      icon: MODULE_ICONS[item.module],
    }));
  }, [access]);

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
        <span className="text-xl font-bold tracking-tight text-white">Social Post</span>
      </div>
      <nav className="flex flex-col gap-1 p-4">
        {visibleNavItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
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
