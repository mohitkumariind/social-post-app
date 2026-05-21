'use client';

import { useDashboardAccessContext } from '@/lib/context/DashboardAccessContext';
import type { DashboardAccessPayload } from '@/lib/rbac/parse-viewer-access';

export type { DashboardAccessPayload as DashboardAccessState };

/** Dashboard RBAC for admin UI — reads from layout {@link DashboardAccessProvider}. */
export function useDashboardAccess(): {
  ready: boolean;
  access: DashboardAccessPayload | null;
  error: string | null;
} {
  return useDashboardAccessContext();
}
