import { createServiceRoleClient } from '@/lib/admin-gate';

export type AdminLogSeverity = 'info' | 'warning' | 'critical';

export type AdminLogInsert = {
  actor_user_id: string | null;
  actor_role: string;
  action_type: string;
  resource_type: string;
  resource_id?: string | null;
  resource_name?: string | null;
  previous_data?: unknown;
  new_data?: unknown;
  metadata?: Record<string, unknown>;
  affected_users_count?: number | null;
  severity?: AdminLogSeverity;
  undoable?: boolean;
  scope_state_ids?: number[];
  scope_group_ids?: string[];
  scope_user_ids?: string[];
  actor_ip?: string | null;
  actor_device?: string | null;
};

function toNumArr(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

function toStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter(Boolean);
}

/**
 * Centralized audit logger for admin operations.
 *
 * Notes:
 * - Uses service role (server-only) so it works even with strict RLS.
 * - Fail-open: returns `{ ok:false }` instead of throwing, so core actions don't break.
 */
export async function logAdminAction(entry: AdminLogInsert): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' };

  const payload = {
    actor_user_id: entry.actor_user_id ?? null,
    actor_role: entry.actor_role,
    action_type: entry.action_type,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id ?? null,
    resource_name: entry.resource_name ?? null,
    previous_data: entry.previous_data ?? null,
    new_data: entry.new_data ?? null,
    metadata: entry.metadata ?? {},
    affected_users_count: entry.affected_users_count ?? null,
    severity: entry.severity ?? 'info',
    undoable: entry.undoable ?? false,
    scope_state_ids: toNumArr(entry.scope_state_ids),
    scope_group_ids: toStrArr(entry.scope_group_ids),
    scope_user_ids: toStrArr(entry.scope_user_ids),
    actor_ip: entry.actor_ip ?? null,
    actor_device: entry.actor_device ?? null,
  };

  const { data, error } = await admin.from('admin_logs').insert(payload as any).select('id').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: String((data as any)?.id ?? '') };
}

