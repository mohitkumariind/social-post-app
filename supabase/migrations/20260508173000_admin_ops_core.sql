-- Admin Operations System (core): admin_logs, scheduled_notifications, notification_templates

-- 1) Activity Center core: immutable audit logs (no soft delete)
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  resource_name TEXT,
  previous_data JSONB,
  new_data JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  affected_users_count INT,
  severity TEXT NOT NULL DEFAULT 'info',
  undoable BOOLEAN NOT NULL DEFAULT false,
  undone_at TIMESTAMPTZ,
  undone_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scope_state_ids BIGINT[] NOT NULL DEFAULT '{}'::bigint[],
  scope_group_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  scope_user_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  actor_ip TEXT,
  actor_device TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at_desc
  ON public.admin_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_actor_created
  ON public.admin_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_resource
  ON public.admin_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action_type
  ON public.admin_logs (action_type);

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
-- Default-deny under RLS; server uses service role for admin dashboard APIs.

-- 2) Scheduled Notifications (soft-delete not needed; cancellation is a status transition)
CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key UUID NOT NULL UNIQUE,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status_scheduled
  ON public.scheduled_notifications (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_created
  ON public.scheduled_notifications (created_by, created_at DESC);

ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;
-- Default-deny under RLS; server uses service role for admin dashboard APIs.

-- 3) Notification Templates (soft-delete via deleted_at)
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  category TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_created_at
  ON public.notification_templates (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_templates_created_by
  ON public.notification_templates (created_by, created_at DESC);

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
-- Default-deny under RLS; server uses service role for admin dashboard APIs.

