import { createServiceRoleClient } from '@/lib/admin-gate';
import { normalizeGroupIds, normalizeStateIds } from '@/lib/rbac/require';

export type RbacObsSeverity = 'info' | 'warning' | 'critical';
export type RbacObsResult = 'allowed' | 'denied';

export type TrackRbacEventInput = {
  user_id: string | null;
  role: string;
  event_type: string;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  result: RbacObsResult;
  scope_state_ids?: number[];
  scope_group_ids?: string[];
  severity?: RbacObsSeverity;
  metadata?: Record<string, unknown>;
};

function toNumArr(v: unknown): number[] {
  return normalizeStateIds(v);
}

function toStrArr(v: unknown): string[] {
  return normalizeGroupIds(v);
}

function isMissingTableErr(err: { message?: string } | null | undefined, tableName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes(tableName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('relation')))
  );
}

export async function trackRbacEvent(input: TrackRbacEventInput): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    if (!admin) return;

    const payload = {
      user_id: input.user_id ?? null,
      role: String(input.role ?? '').trim() || 'unknown',
      event_type: String(input.event_type ?? '').trim() || 'rbac',
      action: String(input.action ?? '').trim() || 'unknown',
      resource_type: String(input.resource_type ?? '').trim() || 'unknown',
      resource_id: input.resource_id ?? null,
      result: input.result,
      scope_state_ids: toNumArr(input.scope_state_ids),
      scope_group_ids: toStrArr(input.scope_group_ids),
      severity: (input.severity ?? 'info') satisfies RbacObsSeverity,
      metadata: input.metadata ?? {},
    };

    const { error } = await admin.from('rbac_observability_events').insert(payload as any);
    if (error) {
      if (isMissingTableErr(error, 'rbac_observability_events')) return;
      // fail-open
      return;
    }
  } catch {
    // fail-open
  }
}

export type AnomalySignal = {
  severity: RbacObsSeverity;
  event_type: 'anomaly';
  action: string;
  metadata: Record<string, unknown>;
};

/**
 * Lightweight anomaly evaluation (non-blocking).
 * Uses ONLY rbac_observability_events; no RBAC impact.
 */
export async function evaluateAnomaliesForUser(params: {
  user_id: string;
  role: string;
}): Promise<AnomalySignal[]> {
  const admin = createServiceRoleClient();
  if (!admin) return [];

  // Window: last 10 minutes
  const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  // A) Cross-scope access attempts: denied > 5 in 10 minutes
  const { count: deniedCount } = await admin
    .from('rbac_observability_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.user_id)
    .eq('result', 'denied')
    .gte('created_at', sinceIso);

  const signals: AnomalySignal[] = [];
  if ((deniedCount ?? 0) > 5) {
    signals.push({
      severity: 'warning',
      event_type: 'anomaly',
      action: 'anomaly.cross_scope_denied_spike',
      metadata: { denied_last_10m: deniedCount ?? 0 },
    });
  }

  // B) Role drift: > 2 denied mutations in short window for moderator/campaign_manager
  if (params.role === 'moderator' || params.role === 'campaign_manager') {
    const { count: deniedWrites } = await admin
      .from('rbac_observability_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', params.user_id)
      .eq('result', 'denied')
      .eq('event_type', 'mutation')
      .gte('created_at', sinceIso);
    if ((deniedWrites ?? 0) > 2) {
      signals.push({
        severity: 'critical',
        event_type: 'anomaly',
        action: 'anomaly.role_drift_denied_mutations',
        metadata: { denied_mutations_last_10m: deniedWrites ?? 0 },
      });
    }
  }

  // C) Activity spike: actions > 200 in 10 minutes (simple baseline-free heuristic)
  const { count: totalCount } = await admin
    .from('rbac_observability_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.user_id)
    .gte('created_at', sinceIso);
  if ((totalCount ?? 0) > 200) {
    signals.push({
      severity: 'warning',
      event_type: 'anomaly',
      action: 'anomaly.high_volume_spike',
      metadata: { events_last_10m: totalCount ?? 0 },
    });
  }

  // D) Undo abuse: undo actions > 5 in 10 min
  const { count: undoCount } = await admin
    .from('rbac_observability_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.user_id)
    .eq('action', 'activity.undo')
    .gte('created_at', sinceIso);
  if ((undoCount ?? 0) > 5) {
    signals.push({
      severity: 'warning',
      event_type: 'anomaly',
      action: 'anomaly.undo_abuse',
      metadata: { undo_last_10m: undoCount ?? 0 },
    });
  }

  return signals;
}

