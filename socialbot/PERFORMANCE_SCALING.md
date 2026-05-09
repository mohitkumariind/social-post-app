# Enterprise Performance & Scalability

This document captures the platform defaults for large-scale campaign workloads while preserving current RBAC behavior.

## API Safety Defaults

- Default list page size: `50`
- Max list page size: `200`
- User frame default page size: `100`
- User frame max page size: `500`
- Cursor-based pagination fields:
  - `cursor_created_at` for created-time descending feeds
  - `cursor_id` for ID-desc fallback paths

These defaults are implemented in `socialbot/lib/perf-defaults.ts`.

## Query Guardrails

- RBAC-sensitive list queries must apply DB-level scoping first (`buildScopedQuery` / `buildScopedAnalyticsQuery`).
- Pagination and limits are required for admin list APIs.
- Avoid fetch-then-filter and large in-memory joins for authorization.

## Observability and Audit Growth

Large deployments can generate high write volume in:

- `admin_logs`
- `rbac_observability_events`
- `notifications_history`

Operational cleanup job:

- Endpoint: `POST /api/jobs/cleanup-operational-data`
- Auth: cron secret (`validateCronRequest`)
- Retention env vars:
  - `RETENTION_ADMIN_LOG_DAYS` (default `180`)
  - `RETENTION_RBAC_OBS_DAYS` (default `30`)
  - `RETENTION_NOTIFICATION_HISTORY_DAYS` (default `120`)

## Caching Strategy (recommended)

Suggested cache layers that do not change business semantics:

- Dashboard counters / analytics cards: short TTL cache (30-120s).
- Group/member counts: cache per viewer scope key + invalidation on membership updates.
- Activity summaries: pre-aggregated rollups with periodic refresh.
- RBAC observability overview: rolling 24h snapshots refreshed every minute.

## Slow-query Observability

Track and alert on:

- high p95 latency for admin list endpoints
- worker batch processing duration
- size of notification recipient sets and push batch fanout
- DB count queries over large windows

## Worker Throughput Defaults

- Keep bounded batch loops in workers (scheduled notifications/posts/events).
- Never process unbounded due queues in a single invocation.
- Prefer lease/claim semantics with retry caps for horizontal scale safety.
