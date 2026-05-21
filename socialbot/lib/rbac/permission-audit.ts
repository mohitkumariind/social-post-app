import { createServiceRoleClient } from '@/lib/admin-gate';
import type { CanonicalScope } from '@/lib/rbac/scope-types';
import type { RbacDebugPayload } from '@/lib/rbac/scope-types';

export type PermissionAuditInput = {
  user_id: string;
  role: string;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  allowed: boolean;
  denied_reason?: string | null;
  normalized_scope?: CanonicalScope | null;
  ownership_match?: boolean;
  visibility_match?: boolean;
  mutation_permission?: boolean;
  metadata?: Record<string, unknown>;
};

function isMissingAuditTable(err: { message?: string } | null | undefined): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes('rbac_audit_logs') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

/**
 * Central permission audit log (fire-and-forget; never blocks authorization).
 */
export function logPermissionDecision(input: PermissionAuditInput): void {
  const admin = createServiceRoleClient();
  if (!admin) {
    console.log('[rbac-audit]', input.action, {
      user_id: input.user_id,
      role: input.role,
      allowed: input.allowed,
      denied_reason: input.denied_reason ?? null,
    });
    return;
  }

  const payload = {
    user_id: input.user_id,
    role: String(input.role ?? '').trim() || 'unknown',
    action: String(input.action ?? '').trim() || 'unknown',
    resource_type: input.resource_type ?? null,
    resource_id: input.resource_id != null ? String(input.resource_id) : null,
    allowed: !!input.allowed,
    denied_reason: input.denied_reason ?? null,
    normalized_scope: input.normalized_scope ?? null,
    ownership_match: input.ownership_match ?? null,
    visibility_match: input.visibility_match ?? null,
    mutation_permission: input.mutation_permission ?? null,
    metadata: input.metadata ?? {},
  };

  void (async () => {
    const { error } = await admin.from('rbac_audit_logs').insert(payload as Record<string, unknown>);
    if (error && !isMissingAuditTable(error)) {
      console.warn('[rbac-audit] insert failed', error.message);
    }
  })();
}

export function logPermissionDecisionFromDebug(
  input: Omit<PermissionAuditInput, 'ownership_match' | 'visibility_match' | 'mutation_permission'> & {
    debug?: Partial<RbacDebugPayload>;
  }
): void {
  logPermissionDecision({
    ...input,
    ownership_match: input.debug?.ownership_match,
    visibility_match: input.debug?.visibility_match,
    mutation_permission: input.debug?.mutation_permission,
    normalized_scope: input.debug?.normalized_scope ?? input.normalized_scope,
    denied_reason: input.denied_reason ?? input.debug?.denied_reason,
  });
}

/** Standard action prefix for mutation gateway audits. */
export function mutationAuditAction(action: string): string {
  const a = String(action ?? '').trim();
  return a.startsWith('mutation.') ? a : `mutation.${a}`;
}

/**
 * Records allow/deny for mutation gateway and API enforcement points.
 * Read-path engine checks log denials only (see permission-engine recordDecision).
 */
export function auditRbacMutation(input: {
  user_id: string;
  role: string;
  mutation_action: string;
  resource_type: string;
  resource_id?: string | null;
  allowed: boolean;
  denied_reason?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  logPermissionDecision({
    user_id: input.user_id,
    role: input.role,
    action: mutationAuditAction(input.mutation_action),
    resource_type: input.resource_type,
    resource_id: input.resource_id ?? null,
    allowed: input.allowed,
    denied_reason: input.allowed ? null : (input.denied_reason ?? 'forbidden'),
    metadata: input.metadata ?? {},
  });
}
