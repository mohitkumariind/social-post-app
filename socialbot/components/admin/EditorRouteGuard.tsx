'use client';

import { canAccessDashboardPath } from '@/lib/rbac/dashboard-access';
import { useDashboardAccess } from '@/lib/hooks/useDashboardAccess';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Legacy guard — prefer {@link DashboardRouteGuard} in admin layout.
 * Uses centralized dashboard path access (no direct role checks).
 */
export default function EditorRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, access } = useDashboardAccess();

  if (!ready) return <>{children}</>;

  const allowed = access?.actor ? canAccessDashboardPath(access.actor, pathname) : true;

  if (!allowed && access?.actor) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-rose-800/40 bg-rose-950/30 p-8 text-center">
        <h2 className="text-xl font-bold text-white">Access Denied</h2>
        <p className="mt-2 text-sm text-zinc-400">This page is not available for your account.</p>
        <Link
          href="/admin/events"
          className="mt-6 inline-block rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
        >
          Go to Events
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
