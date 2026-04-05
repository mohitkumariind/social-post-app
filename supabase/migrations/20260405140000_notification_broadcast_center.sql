-- Notification Broadcast Center: aggregate rows + per-user opens + link history to broadcast

CREATE TABLE IF NOT EXISTS public.notification_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_user_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  opened_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_created
  ON public.notification_broadcasts (created_at DESC);

ALTER TABLE public.notifications_history
  ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES public.notification_broadcasts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.notification_open (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES public.notification_broadcasts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_open_broadcast_user UNIQUE (broadcast_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_open_broadcast ON public.notification_open (broadcast_id);

CREATE OR REPLACE FUNCTION public.bump_notification_broadcast_opened()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notification_broadcasts
  SET opened_count = opened_count + 1
  WHERE id = NEW.broadcast_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notification_open_bump ON public.notification_open;
CREATE TRIGGER tr_notification_open_bump
AFTER INSERT ON public.notification_open
FOR EACH ROW
EXECUTE FUNCTION public.bump_notification_broadcast_opened();

ALTER TABLE public.notification_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_open ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_broadcasts_select_authenticated" ON public.notification_broadcasts;
CREATE POLICY "notification_broadcasts_select_authenticated"
  ON public.notification_broadcasts
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "notification_open_insert_own" ON public.notification_open;
CREATE POLICY "notification_open_insert_own"
  ON public.notification_open
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_open_select_own" ON public.notification_open;
CREATE POLICY "notification_open_select_own"
  ON public.notification_open
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
