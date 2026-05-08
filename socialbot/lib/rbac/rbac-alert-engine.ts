import { logAdminAction } from '@/lib/audit/logAdminAction';
import type { AnomalySignal } from '@/lib/rbac/rbac-observability-engine';

/**
 * Optional alert engine:
 * - critical anomalies => immediate admin_logs entry for visibility
 * - warning anomalies => left to daily reporting (future hook)
 *
 * Fail-open: never throws.
 */
export async function emitRbacAlerts(args: {
  user_id: string;
  role: string;
  signals: AnomalySignal[];
}): Promise<void> {
  try {
    const critical = args.signals.filter((s) => s.severity === 'critical');
    if (critical.length === 0) return;

    for (const s of critical.slice(0, 5)) {
      void logAdminAction({
        actor_user_id: args.user_id,
        actor_role: args.role,
        action_type: 'rbac.anomaly.critical',
        resource_type: 'rbac_observability',
        resource_id: null,
        resource_name: s.action,
        previous_data: null,
        new_data: { signal: s },
        metadata: { user_id: args.user_id, role: args.role, ...s.metadata },
        severity: 'critical',
        undoable: false,
        scope_user_ids: [args.user_id],
      });
    }
  } catch {
    // fail-open
  }
}

