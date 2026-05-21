import type { RbacDebugPayload } from '@/lib/rbac/scope-types';

export function logRbacDebug(action: string, payload: RbacDebugPayload): void {
  console.log('[rbac]', action, {
    role: payload.role,
    normalized_scope: payload.normalized_scope,
    ownership_match: payload.ownership_match,
    visibility_match: payload.visibility_match,
    mutation_permission: payload.mutation_permission,
    denied_reason: payload.denied_reason ?? null,
  });
}
