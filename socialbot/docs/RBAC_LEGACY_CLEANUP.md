# RBAC legacy cleanup (Phase 4)

## Removed / consolidated

| Removed pattern | Replacement |
|-----------------|-------------|
| `assertNotEditor` / `applyEditorEventCreatePayload` in `lib/editor-access.ts` | `lib/rbac/editor-panel.ts` (`editor-access` re-exports only) |
| Parallel mutation audit (`auditDenied` only) | `auditRbacMutation` — **allow + deny** on all `canPerformMutation` paths when `audit` ctx passed |
| Per-render event permission calls in list loop | `buildEventPermissionMap` + `useMemo` on events page |
| `normalizeScope` in dashboard filter bundle | `getCachedNormalizedScope` in `dashboard-permissions` |
| `scoped-write-engine` as mutation entry | `mutation-gateway.ts` (scoped-write-engine re-exports) |

## Deprecated shims (do not extend)

| Path | Use instead |
|------|-------------|
| `lib/permissions.ts` (`isAdmin`, `isModerator`, …) | `isAdminRole`, `isModeratorRole` from `@/lib/rbac` |
| `lib/admin-gate.ts` `isAdmin(auth)` | `isAdminRole(auth.role)` |
| `lib/rbac/scoped-write-engine.ts` | `@/lib/rbac/mutation-gateway` |
| `lib/editor-access.ts` | `editor-panel` + `dashboard-access` for paths |

## Active bridges (intentional)

| Path | Role |
|------|------|
| `lib/admin/rbac.ts` | Analytics SQL literals — aligned with `toAdminAnalyticsScopeFromDashboard` |
| `lib/event-access.ts` | API event payload validation → permission-engine |
| `lib/rbac/event-list-scope.ts` | List pre-filter + `filterVisibleEvents` |
| `requireRole` / `requireStandardRbacContext` | Session + assignment gate before engine |

## Forbidden in new code

See `lib/rbac/authority.ts`. No new inline `role ===` authorization; no duplicate scope engines.

## Validation

```bash
cd socialbot && npm test -- tests/rbac/
```
