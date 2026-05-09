# Security Defense-in-Depth Standard

This project enforces layered security for privileged operations.

## Required Layers

1. **Edge layer** (`proxy.ts`)
   - `/api/admin/*` requires authenticated session + allowed role.
   - `/api/jobs/*` and `/api/cron/*` require valid cron secret.
   - Rejections emit structured edge security logs.

2. **Route layer**
   - `validateAdminSession(...)`
   - `requireStandardRbacContext(...)` (or strict `requireRole` where appropriate)
   - fail-closed input validation

3. **RBAC engine layer**
   - Read/query: `canAccessResource(...)`, `buildScopedQuery(...)`
   - Write: `canPerformMutation(...)`
   - Unknown resources fail-closed via registry validation.

## Service-Role Safety Rules

- Service-role client usage is allowed only after route/session/RBAC checks.
- Any service-role mutation on RBAC resources must have:
  - role gate
  - mutation gate (`canPerformMutation`) where resource supports mutation layer
  - explicit deny paths

## Forbidden Patterns

- Fetch-global-then-filter RBAC.
- Unknown resource fallback to `created_by=self`.
- Overlap-based authorization for scoped resources.
- Public success stubs for privileged APIs.

## Required Logging

- Denied mutations and unsupported resource access must emit:
  - RBAC observability events
  - admin audit logs
- Edge rejects should be structured and machine-parseable.

## Abuse-Protection Defaults

Defined in `lib/security-limits.ts`:

- bulk mutation caps
- group operation caps
- storage remove path caps
- upload size caps

These are fail-closed safeguards and must not be removed in new privileged routes.

## RLS Posture

RLS assumptions and table posture should be explicit in schema docs and migrations.
Service-role usage is not a replacement for route-level RBAC checks.
