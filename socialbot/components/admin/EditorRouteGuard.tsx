'use client';

import { isEditorAllowedAdminPath } from '@/lib/editor-access';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Client defense-in-depth: editors may only use /admin/events (edge proxy also enforces).
 */
export default function EditorRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/viewer', { credentials: 'same-origin' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => ({}))) as { role?: string };
        if (!cancelled) setRole(typeof d.role === 'string' ? d.role : null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return <>{children}</>;

  if (role === 'editor' && !isEditorAllowedAdminPath(pathname)) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-rose-800/40 bg-rose-950/30 p-8 text-center">
        <h2 className="text-xl font-bold text-white">Access Denied</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Your account has the Editor role. You may only manage your own events.
        </p>
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
