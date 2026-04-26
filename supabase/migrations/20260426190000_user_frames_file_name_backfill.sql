-- Ensure user_frames has a file_name column and backfill it from URL.
-- This enables alphabetical/numerical ordering like _001, _002... in the app.

ALTER TABLE IF EXISTS public.user_frames
  ADD COLUMN IF NOT EXISTS file_name text;

-- Backfill: derive last path segment from the public URL (strip query params).
-- Example URL: https://.../storage/v1/object/public/user-frames/public/<uid>/<ts>-_001.png
UPDATE public.user_frames
SET file_name = NULLIF(
  regexp_replace(split_part(url, '?', 1), '^.*/', ''),
  ''
)
WHERE (file_name IS NULL OR btrim(file_name) = '')
  AND url IS NOT NULL
  AND btrim(url) <> '';

