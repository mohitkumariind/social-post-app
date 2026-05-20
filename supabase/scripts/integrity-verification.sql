-- Integrity verification helper queries.
-- Run manually after migrations to detect legacy rows that violate hardening rules.
-- This file is read-only: it does not mutate data.

-- 1) Invalid lifecycle/status values
SELECT 'events.status invalid' AS check_name, status AS value, count(*) AS rows_count
FROM public.events
WHERE status NOT IN ('published', 'scheduled_publish', 'processing_publish', 'archived', 'scheduled_publish_failed')
GROUP BY status;

SELECT 'posts.status invalid' AS check_name, status AS value, count(*) AS rows_count
FROM public.posts
WHERE status NOT IN ('published', 'scheduled_publish', 'processing_publish', 'scheduled_publish_failed')
GROUP BY status;

SELECT 'scheduled_notifications.status invalid' AS check_name, status AS value, count(*) AS rows_count
FROM public.scheduled_notifications
WHERE status NOT IN ('pending', 'processing', 'failed', 'sent', 'cancelled')
GROUP BY status;

SELECT 'admin_logs.severity invalid' AS check_name, severity AS value, count(*) AS rows_count
FROM public.admin_logs
WHERE severity NOT IN ('info', 'warning', 'critical')
GROUP BY severity;

SELECT 'profiles.role invalid' AS check_name, role AS value, count(*) AS rows_count
FROM public.profiles
WHERE role NOT IN ('worker', 'moderator', 'user', 'admin', 'editor', 'super_admin', 'campaign_manager')
GROUP BY role;

-- 2) Malformed RBAC assignments
SELECT 'profiles moderator missing assigned_state_ids' AS check_name, count(*) AS rows_count
FROM public.profiles
WHERE role = 'moderator'
  AND cardinality(COALESCE(assigned_state_ids, '{}'::bigint[])) = 0;

SELECT 'profiles campaign_manager missing assigned_group_ids' AS check_name, count(*) AS rows_count
FROM public.profiles
WHERE role = 'campaign_manager'
  AND cardinality(COALESCE(assigned_group_ids, '{}'::text[])) = 0;

SELECT 'profiles assigned_group_ids non-canonical' AS check_name, count(*) AS rows_count
FROM public.profiles p
WHERE EXISTS (
  SELECT 1 FROM unnest(COALESCE(p.assigned_group_ids, '{}'::text[])) AS g
  WHERE g !~ '^[1-9][0-9]*$'
);

SELECT 'profiles assigned_state_ids non-positive' AS check_name, count(*) AS rows_count
FROM public.profiles p
WHERE EXISTS (
  SELECT 1 FROM unnest(COALESCE(p.assigned_state_ids, '{}'::bigint[])) AS s
  WHERE s <= 0
);

-- 3) Scope array integrity in logs/observability
SELECT 'admin_logs scope_group_ids non-canonical' AS check_name, count(*) AS rows_count
FROM public.admin_logs a
WHERE EXISTS (
  SELECT 1 FROM unnest(COALESCE(a.scope_group_ids, '{}'::text[])) AS g
  WHERE g !~ '^[1-9][0-9]*$'
);

SELECT 'admin_logs scope_state_ids non-positive' AS check_name, count(*) AS rows_count
FROM public.admin_logs a
WHERE EXISTS (
  SELECT 1 FROM unnest(COALESCE(a.scope_state_ids, '{}'::bigint[])) AS s
  WHERE s <= 0
);

SELECT 'rbac_observability_events scope_group_ids non-canonical' AS check_name, count(*) AS rows_count
FROM public.rbac_observability_events r
WHERE EXISTS (
  SELECT 1 FROM unnest(COALESCE(r.scope_group_ids, '{}'::text[])) AS g
  WHERE g !~ '^[1-9][0-9]*$'
);

SELECT 'rbac_observability_events scope_state_ids non-positive' AS check_name, count(*) AS rows_count
FROM public.rbac_observability_events r
WHERE EXISTS (
  SELECT 1 FROM unnest(COALESCE(r.scope_state_ids, '{}'::bigint[])) AS s
  WHERE s <= 0
);

-- 4) Orphan detection
SELECT 'group_memberships orphan user_id' AS check_name, count(*) AS rows_count
FROM public.group_memberships gm
LEFT JOIN public.profiles p ON p.id = gm.user_id
WHERE p.id IS NULL;

SELECT 'group_memberships orphan group_id' AS check_name, count(*) AS rows_count
FROM public.group_memberships gm
LEFT JOIN public.groups g ON g.id = gm.group_id
WHERE g.id IS NULL;

SELECT 'notifications_history orphan broadcast_id' AS check_name, count(*) AS rows_count
FROM public.notifications_history nh
LEFT JOIN public.notification_broadcasts nb ON nb.id = nh.broadcast_id
WHERE nh.broadcast_id IS NOT NULL
  AND nb.id IS NULL;

-- 5) Scheduler dedup/ownership consistency
SELECT 'scheduled_notifications duplicate idempotency_key' AS check_name, idempotency_key::text AS value, count(*) AS rows_count
FROM public.scheduled_notifications
GROUP BY idempotency_key
HAVING count(*) > 1;

SELECT 'notifications_history duplicate broadcast+user' AS check_name,
       concat(broadcast_id::text, ':', user_id::text) AS value,
       count(*) AS rows_count
FROM public.notifications_history
WHERE broadcast_id IS NOT NULL
GROUP BY broadcast_id, user_id
HAVING count(*) > 1;

-- 6) Soft-delete consistency
SELECT 'events deleted_by without deleted_at' AS check_name, count(*) AS rows_count
FROM public.events
WHERE deleted_by IS NOT NULL
  AND deleted_at IS NULL;

SELECT 'groups deleted_by without deleted_at' AS check_name, count(*) AS rows_count
FROM public.groups
WHERE deleted_by IS NOT NULL
  AND deleted_at IS NULL;

SELECT 'notification_templates deleted_by without deleted_at' AS check_name, count(*) AS rows_count
FROM public.notification_templates
WHERE deleted_by IS NOT NULL
  AND deleted_at IS NULL;
