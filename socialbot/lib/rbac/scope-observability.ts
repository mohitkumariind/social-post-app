import { getCachedNormalizedScope } from '@/lib/rbac/scope-cache';
import type { RbacActor } from '@/lib/rbac/scope-types';
import type { UnifiedUser } from '@/lib/rbac/unified-scope-engine';

/** Flat scope snapshot for audit logs and observability (includes constituency dimensions). */
export function rbacScopeMetadata(
  actor: Pick<
    RbacActor,
    | 'assigned_state_ids'
    | 'assigned_group_ids'
    | 'assigned_party_ids'
    | 'assigned_loksabha_ids'
    | 'assigned_assembly_ids'
    | 'effective_group_ids'
  >
): Record<string, unknown> {
  const scope = getCachedNormalizedScope(actor as RbacActor);
  return {
    scope_state_ids: scope.state_ids,
    scope_party_ids: scope.party_ids,
    scope_party_slugs: scope.party_slugs,
    scope_loksabha_ids: scope.loksabha_ids,
    scope_assembly_ids: scope.assembly_ids,
    scope_group_ids: scope.group_ids,
  };
}

export function rbacScopeMetadataFromUser(user: UnifiedUser): Record<string, unknown> {
  return rbacScopeMetadata({
    assigned_state_ids: user.assigned_state_ids,
    assigned_group_ids: user.assigned_group_ids ?? [],
    assigned_party_ids: user.assigned_party_ids ?? [],
    assigned_loksabha_ids: user.assigned_loksabha_ids,
    assigned_assembly_ids: user.assigned_assembly_ids,
  });
}
