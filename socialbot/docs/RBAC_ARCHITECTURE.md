# RBAC Architecture Standard

This project uses a centralized, fail-closed RBAC model. Route-level authorization must align with the shared RBAC engines and helpers.

## Core Engines

- `requireRole` / `requireStandardRbacContext` (`lib/rbac/require.ts`)
  - Entry gate for authenticated admin APIs.
  - Enforces role allowlists.
  - Enforces assignment integrity:
    - moderator requires non-empty `assigned_state_ids`
    - campaign_manager requires non-empty canonical `assigned_group_ids`

- `canAccessResource` (`lib/rbac/unified-scope-engine.ts`)
  - Unified read/access decision engine.
  - Handles role scope decisions and denied observability/audit emission.

- `buildScopedQuery` / `buildScopedAnalyticsQuery` (`lib/rbac/scoped-query-builder.ts`)
  - Database-layer query scoping.
  - Prevents fetch-then-filter RBAC drift.

- `canPerformMutation` (`lib/rbac/scoped-write-engine.ts`)
  - Centralized write/mutation authorization.
  - Emits consistent denied audit + RBAC observability events.

- `RBAC_RESOURCE_REGISTRY` (`lib/rbac/resource-classification.ts`)
  - Canonical resource policy registry:
    - scope model
    - fallback policy
    - supported RBAC layers
    - analytics behavior

## Canonical Scope Semantics

### Moderator

- Resource scope must be a **subset** of `assigned_state_ids`.
- Missing/malformed state scope => deny (fail-closed).

### Campaign Manager

- Resource group scope (`group_id` / `group_ids`) must be a **subset** of `assigned_group_ids`.
- Missing/malformed group scope => deny (fail-closed).

### Admin

- Global access, unchanged.

### Overlap vs Subset

- **Subset is the default policy** for scoped resources.
- Overlap checks are not used for authorization decisions.
- This avoids scope leakage and cross-layer semantic drift.

## ID Normalization Standard

- State IDs: positive integers.
- Group IDs: canonical numeric strings (`"01"` normalized to `"1"`).
- Use `parseStateIds`, `parseGroupIds`, `normalizeStateId`, `normalizeGroupId` from `require.ts`.
- Do not compare mixed raw string/number IDs in route code.

## Ownership Fallback Policy

- Scoped resources must not silently fall back to ownership when scope is missing.
- Ownership fallback is allowed only for explicitly registered owner-only/legacy resources in `RBAC_RESOURCE_REGISTRY`.

## Unknown Resource Handling

- Unknown/unregistered resource types are denied.
- No `created_by=self` silent fallback for unregistered resources.
- Use `validateRegisteredResourceForLayer(...)` via the centralized engines.

## Standard Route Pattern

1. Validate session.
2. `requireStandardRbacContext(auth, [...allowedRoles])`.
3. DB reads:
   - use `buildScopedQuery` / `buildScopedAnalyticsQuery`.
4. Mutations:
   - call `canPerformMutation(...)` before write.
5. Optional explicit read guard:
   - `canAccessResource(...)` for pre-read detail checks.

## Denied Event Consistency

- Denied access/mutation should produce:
  - RBAC observability event
  - admin audit log entry
- Centralized engines already do this for resource validation and mutation denials.

Use direct `return 403` only for pre-RBAC request shape errors; prefer engine-driven denial for policy decisions.
