/**
 * RBAC authority contract — do not add parallel permission systems.
 *
 * Allowed:
 * - `permission-engine.ts` — all allow/deny semantics
 * - `permission-mutations.ts` / `mutation-gateway.ts` — writes
 * - `dashboard-permissions.ts` — module + filter entitlements
 * - `dashboard-access.ts` — route/API/sidebar mapping only
 * - `ui-capabilities.ts` — client UI bundle only
 * - `scoped-query-builder.ts` — DB list predicates (must match engine scope)
 *
 * Forbidden in new code:
 * - Inline `role === 'admin'` for authorization (use engine or dashboard-permissions)
 * - Duplicate scope checks outside `canAccessScope` / `buildScopedQuery`
 * - Direct Supabase mutations from admin pages (use API + mutation gateway)
 */

export const RBAC_AUTHORITY_MODULE = '@/lib/rbac/permission-engine' as const;
export const RBAC_MUTATION_GATEWAY = '@/lib/rbac/mutation-gateway' as const;
