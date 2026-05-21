'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { logDashboardUiRbac } from '@/lib/rbac/dashboard-ui-log';
import { parseViewerDashboardAccess, type DashboardAccessPayload } from '@/lib/rbac/parse-viewer-access';

type DashboardAccessContextValue = {
  ready: boolean;
  access: DashboardAccessPayload | null;
  error: string | null;
};

const DashboardAccessContext = createContext<DashboardAccessContextValue>({
  ready: false,
  access: null,
  error: null,
});

export function DashboardAccessProvider({ children }: { children: React.ReactNode }) {
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/viewer', { credentials: 'same-origin' });
        if (!res.ok) {
          if (!cancelled) setError(res.status === 401 ? 'Unauthorized' : 'Forbidden');
          return;
        }
        const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!cancelled) setRaw(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load access');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const access = useMemo(() => {
    if (!raw) return null;
    return parseViewerDashboardAccess(raw, 'session');
  }, [raw]);

  useEffect(() => {
    if (!access) return;
    logDashboardUiRbac('provider_ready', {
      role: access.actor.role,
      allowed_modules: access.allowed_modules,
      hidden_modules: access.hidden_modules,
      filter_visibility: access.filter_visibility,
    });
  }, [access]);

  const value = useMemo(
    () => ({ ready, access, error }),
    [ready, access, error]
  );

  return (
    <DashboardAccessContext.Provider value={value}>{children}</DashboardAccessContext.Provider>
  );
}

export function useDashboardAccessContext(): DashboardAccessContextValue {
  return useContext(DashboardAccessContext);
}
