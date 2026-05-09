# RBAC Developer Safety Guide

Follow this checklist when adding a new RBAC-protected API or resource.

## 1) Register the Resource First

Add the resource to `lib/rbac/resource-classification.ts` (`RBAC_RESOURCE_REGISTRY`) with:

- category (`scoped`, `owner_only`, etc.)
- scope model
- fallback policy
- supported layers (`query`, `analytics`, `access`, `mutation`)

If it is not registered, RBAC engines deny by default.

## 2) Use Standard Route Guards

- Validate session.
- Call `requireStandardRbacContext(...)` with allowed roles.
- Avoid ad-hoc role checks as primary authorization gates.

## 3) Reads Must Be DB-Scoped

- Use `buildScopedQuery(...)` for list/detail queries.
- Use `buildScopedAnalyticsQuery(...)` (or `buildScopedAggregationQuery`) for metrics.
- Never fetch globally and filter in memory.

## 4) Writes Must Use Mutation Engine

- Call `canPerformMutation(...)` before any insert/update/delete.
- Pass `resourceType`, `resourceId`, and `resourceName` audit context where available.

## 5) Keep ID Handling Canonical

- State IDs: parse via `parseStateIds(...)`.
- Group IDs: parse via `parseGroupIds(...)`.
- Never compare raw mixed string/number IDs.

## 6) Avoid Scope Weakening

- Do not use overlap logic for authorization.
- Scoped resource checks are subset-based.
- Missing scope fields on scoped resources should deny.

## 7) Keep Denials Observable

- Prefer centralized engine denials so audit + observability are emitted consistently.
- If early-denying due to malformed input, include structured error and keep fail-closed behavior.

## 8) Pagination and Scale Defaults

- Use `clampLimit(...)` from `lib/perf-defaults.ts`.
- Provide cursor fields for list endpoints with growing datasets.
- Do not return unbounded lists from admin APIs.

## 9) Test Before Merge

- Build: `npm run build` in `socialbot`.
- Verify:
  - admin/mod/campaign_manager behavior
  - out-of-scope denial paths
  - unknown resource fail-closed behavior
