# Production Migration Precheck

Use this checklist before running new production migrations.

## 1) Validate existing data first

Run `supabase/scripts/integrity-verification.sql` against the target database before applying new constraints.

- Any returned rows are blockers for strict constraints.
- Resolve data violations before rollout to avoid failed deploys.

## 2) Confirm required secrets and cron gates

Before deployment, verify these are set in production:

- `CRON_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`

For legacy edge function safety:

- Keep `ENABLE_LEGACY_NOTIFY_WORKERS=false` (or unset) unless an explicit migration window requires it.
- If enabled temporarily, also set `LEGACY_NOTIFY_WORKERS_SECRET`.

## 3) Rollout order for schema + workers

1. Apply schema migrations.
2. Run integrity verification script again.
3. Deploy app/runtime workers.
4. Trigger one manual run each for:
   - `/api/jobs/process-scheduled-posts`
   - `/api/jobs/process-scheduled-events`
   - `/api/jobs/process-scheduled-notifications`
   - `/api/cron/twitter-campaign` (or `POST /api/admin/twitter-campaigns/run-workers` while logged in as admin)
   - `/api/jobs/cleanup-operational-data`
   - `/api/jobs/cleanup-scheduler-state`
5. Confirm logs include `*.start` and `*.done` structured events.

## 4) Post-deploy smoke checks

- Verify scheduled jobs are progressing (`pending/processing` counts should trend down).
- Verify no duplicate `notifications_history` for a broadcast/user pair.
- Verify cleanup jobs report bounded batch metrics (not a single unbounded delete).

## 5) Safe rollback posture

- If worker failures spike after migration, pause cron triggers first.
- Re-enable only after verifying lock/retry columns and indexes exist as expected.
