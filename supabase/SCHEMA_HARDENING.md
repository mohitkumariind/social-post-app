# Enterprise Schema Hardening

This document describes the integrity model introduced by `20260509181000_enterprise_schema_integrity_hardening.sql`.

## Layered Integrity Model

- **Application RBAC**: API routes enforce `validateAdminSession`, `requireRole`, `canAccessResource`, and `canPerformMutation`.
- **DB constraints (this hardening pass)**: lifecycle/status checks, RBAC scope-array checks, and soft-delete consistency checks.
- **DB indexes**: scheduler/queue and active-row indexes reduce scan amplification and protect scale behavior.

This is intentionally additive hardening. Existing APIs and workflows remain unchanged.

## Lifecycle State Contracts

- `events.status` must be one of:
  - `published`
  - `scheduled_publish`
  - `processing_publish`
  - `archived`
  - `scheduled_publish_failed`
- `posts.status` must be one of:
  - `published`
  - `scheduled_publish`
  - `processing_publish`
  - `scheduled_publish_failed`
- `scheduled_notifications.status` must be one of:
  - `pending`
  - `processing`
  - `failed`
  - `sent`
  - `cancelled`
- `admin_logs.severity` uses:
  - `info`
  - `warning`
  - `critical`

## RBAC Integrity Rules

- `profiles.role` is constrained to:
  - `user`, `admin`, `moderator`, `campaign_manager`
- Moderator profiles must have non-empty `assigned_state_ids`.
- Campaign-manager profiles must have non-empty `assigned_group_ids`.
- `assigned_group_ids`, `scope_group_ids`, and related group-scope arrays store canonical numeric strings only (`^[1-9][0-9]*$`).
- State-scope arrays are constrained to positive integers.

## Soft-Delete Guarantees

- For `events`, `groups`, and `notification_templates`, `deleted_by` cannot be set unless `deleted_at` is set.
- `notification_templates.deleted_by` is added for lifecycle symmetry and future audit consistency.

## Scheduler/Worker Guarantees

- Non-negative retry counters are enforced for:
  - `scheduled_notifications.attempt_count`
  - `posts.attempt_count`
  - `events.attempt_count`
- Additional partial indexes support due-queue and stale-lock worker queries.

## Foreign-Key Guarantees

- `posts.group_id -> groups.id` (nullable; `ON DELETE SET NULL`).
- `notifications_history.user_id -> profiles.id` (cascade delete).

These reduce orphaned references and lifecycle drift.

## Migration Safety Notes

- New `CHECK` constraints are added as `NOT VALID` to preserve existing legacy rows while enforcing all future writes.
- After cleaning legacy data, run:
  - `ALTER TABLE ... VALIDATE CONSTRAINT ...`
- For integrity drift audits, run:
  - `supabase/scripts/integrity-verification.sql`

## Verification Workflow

1. Apply migrations.
2. Execute `supabase/scripts/integrity-verification.sql`.
3. Fix any reported legacy data.
4. Validate constraints in maintenance windows.
