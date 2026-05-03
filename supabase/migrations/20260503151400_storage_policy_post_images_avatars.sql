-- Allow authenticated users to upload their own avatar images into:
--   bucket: post-images
--   folder: avatars/<uid>-<timestamp>.jpg
--
-- The code uploads avatars to `post-images/avatars/*`.
-- Existing policies in this codebase restrict `post-images` uploads to admin only,
-- which breaks profile photo upload for normal users.

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Replace policies if re-applied
DROP POLICY IF EXISTS "storage_insert_user_avatars_in_post_images" ON storage.objects;
DROP POLICY IF EXISTS "storage_update_user_avatars_in_post_images" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_user_avatars_in_post_images" ON storage.objects;

-- Insert: authenticated users can upload ONLY under `avatars/` in `post-images`.
-- `owner` is set by Storage based on the JWT; enforce owner = auth.uid().
CREATE POLICY "storage_insert_user_avatars_in_post_images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'post-images'
  AND name LIKE 'avatars/%'
  AND owner = auth.uid()
);

-- Update: user can update only their own avatar objects under `avatars/`.
CREATE POLICY "storage_update_user_avatars_in_post_images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'post-images'
  AND name LIKE 'avatars/%'
  AND owner = auth.uid()
)
WITH CHECK (
  bucket_id = 'post-images'
  AND name LIKE 'avatars/%'
  AND owner = auth.uid()
);

-- Delete: user can delete only their own avatar objects under `avatars/`.
CREATE POLICY "storage_delete_user_avatars_in_post_images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'post-images'
  AND name LIKE 'avatars/%'
  AND owner = auth.uid()
);

