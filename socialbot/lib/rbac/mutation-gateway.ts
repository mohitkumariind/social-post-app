/**
 * Unified mutation RBAC gateway.
 * All server-side writes MUST call {@link canPerformMutation} from this module (or `@/lib/rbac`).
 */
export {
  canPerformMutation,
  type MutationAction,
  type MutationDecision,
} from '@/lib/rbac/permission-mutations';
