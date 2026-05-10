-- Canonical PNG overlay URL for user-uploaded frames (dashboard + app).
-- Legacy rows use `url`; new writes should set both `url` and `overlay_url`.

ALTER TABLE IF EXISTS public.user_frames
  ADD COLUMN IF NOT EXISTS overlay_url text;

UPDATE public.user_frames
SET overlay_url = NULLIF(trim(url), '')
WHERE (overlay_url IS NULL OR trim(overlay_url) = '')
  AND url IS NOT NULL
  AND trim(url) <> '';
