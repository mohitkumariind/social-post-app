# Worker & Scheduler Architecture

This project uses a lease-based worker model for scheduled jobs.

## Entry Points

- `POST /api/jobs/process-scheduled-posts`
- `POST /api/jobs/process-scheduled-events`
- `POST /api/jobs/process-scheduled-notifications`
- `POST /api/jobs/analytics-daily-rollup`
- `POST /api/jobs/cleanup-operational-data`
- `POST /api/jobs/cleanup-scheduler-state`
- `GET /api/cron/process-notifications` (cron health/trigger endpoint)

All job/cron routes require `CRON_SECRET` via `validateCronRequest`.

## Standard Lease/Retry Model

Shared runtime helper: `lib/workers/runtime.ts`

- `resolveWorkerRuntime(...)`:
  - worker id
  - lease timeout
  - max attempts
  - batch size
- `computeExponentialBackoffMs(...)`
- `nowIso()`, `staleIso(...)`

Default behavior:

- claim due rows with conditional updates
- process only if lease ownership still matches (`locked_by`, `locked_at`)
- release/transition state with conditional updates
- bounded retries with exponential backoff
- terminal failure state after max attempts

## Idempotency Guarantees

- `scheduled_notifications.idempotency_key` prevents duplicate logical schedules.
- Worker reuses `broadcast_id` across retries for notification sends.
- `notifications_history` unique `(broadcast_id, user_id)` prevents duplicate history rows.
- Publish workers only transition from expected status/lease owner, preventing duplicate publish transitions.

## Stale Lock Reclaim

- Due scans include stale processing rows (`locked_at < now - lease_ms`).
- Notifications worker renews lease before long send operations.
- Cleanup job clears stale lock metadata on non-processing rows.

## Throughput Controls

Env-configurable worker defaults:

- `WORKER_LEASE_MS`
- `WORKER_MAX_ATTEMPTS`
- `WORKER_BATCH_SIZE`

Retention cleanup env vars:

- `RETENTION_SCHEDULED_NOTIFICATIONS_DAYS`
- `RETENTION_FAILED_PUBLISH_DAYS`

## Observability

Worker responses include:

- `duration_ms`
- claimed/reclaimed/succeeded/failed/skipped counts
- runtime config values (batch size, max attempts, lease ms)

Notification worker emits existing audit actions for sent/failed outcomes and RBAC scope validation denials.

## Operational Notes

- Keep cron schedules frequent and small-batch for horizontal scaling.
- Prefer multiple short worker runs over large single runs.
- Tune batch and lease values based on p95 execution time and queue depth.
