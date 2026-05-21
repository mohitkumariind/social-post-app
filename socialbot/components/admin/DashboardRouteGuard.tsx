'use client';

import {
  canAccessDashboardPath,
  getVisibleSidebarItems,
  logDashboardAccessDebug,
} from '@/lib/rbac/dashboard-access';
import { logDashboardUiRbac } from '@/lib/rbac/dashboard-ui-log';
import { useDashboardAccess } from '@/lib/hooks/useDashboardAccess';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo } from 'react';

/**
 * Client route guard: blocks direct URL access to modules not in centralized dashboard RBAC.
 */
export default function DashboardRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, access } = useDashboardAccess();

  const allowed = useMemo(() => {
    if (!access?.actor) return true;
    return canAccessDashboardPath(access.actor, pathname);
  }, [access, pathname]);

  useEffect(() => {
    if (!ready || !access?.actor || allowed) return;
    logDashboardAccessDebug('route_denied', {
      role: access.actor.role,
      allowed_modules: access.allowed_modules,
      pathname,
      global_filter_access: access.filter_visibility.canUseGlobalFilters,
    });
    logDashboardUiRbac('route_denied', {
      role: access.actor.role,
      allowed_modules: access.allowed_modules,
      hidden_modules: access.hidden_modules,
      filter_visibility: access.filter_visibility,
    });
  }, [ready, access, allowed, pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-400">
        Loading access…
      </div>
    );
  }

  if (!allowed && access?.actor) {
    const fallback = getVisibleSidebarItems(access.actor)[0]?.href ?? '/admin/events';
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-rose-800/40 bg-rose-950/30 p-8 text-center">
        <h2 className="text-xl font-bold text-white">Access Denied</h2>
        <p className="mt-2 text-sm text-zinc-400">This module is not available for your role.</p>
        <Link
          href={fallback}
          className="mt-6 inline-block rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
        >
          Go to allowed area
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
