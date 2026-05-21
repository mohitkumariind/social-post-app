-- Central RBAC permission audit trail.

CREATE TABLE IF NOT EXISTS public.rbac_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  role text NOT NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  allowed boolean NOT NULL,
  denied_reason text,
  normalized_scope jsonb,
  ownership_match boolean,
  visibility_match boolean,
  mutation_permission boolean,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_user_created
  ON public.rbac_audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_action_created
  ON public.rbac_audit_logs (action, created_at DESC);

ALTER TABLE public.rbac_audit_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.rbac_audit_logs IS
  'Permission decisions from centralized RBAC engine (create/edit/upload/broadcast/etc).';
