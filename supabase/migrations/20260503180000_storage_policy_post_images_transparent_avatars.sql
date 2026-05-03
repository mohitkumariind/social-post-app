-- Allow authenticated users to upload/read their own cached transparent cutout (PixelBin output):
--   bucket: post-images
--   object: transparent-avatars/<auth.uid()>.png
--
-- Matches app/(auth)/post-detail.tsx path getTransparentCutoutObjectPath(userId).
--
-- If the SQL editor returns 42501 (must be owner of table objects), do not run
-- ALTER on storage.objects. RLS is already enabled on storage.objects by Supabase.
-- Use: Dashboard -> Storage -> post-images -> Policies, or `supabase db push` / migration pipeline.

DROP POLICY IF EXISTS "storage_insert_user_transparent_avatar_cutout" ON storage.objects;
DROP POLICY IF EXISTS "storage_update_user_transparent_avatar_cutout" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_user_transparent_avatar_cutout" ON storage.objects;

CREATE POLICY "storage_insert_user_transparent_avatar_cutout"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'post-images'
  AND name = ('transparent-avatars/' || auth.uid()::text || '.png')
  AND owner = auth.uid()
);

CREATE POLICY "storage_update_user_transparent_avatar_cutout"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'post-images'
  AND name = ('transparent-avatars/' || auth.uid()::text || '.png')
  AND owner = auth.uid()
)
WITH CHECK (
  bucket_id = 'post-images'
  AND name = ('transparent-avatars/' || auth.uid()::text || '.png')
  AND owner = auth.uid()
);

CREATE POLICY "storage_delete_user_transparent_avatar_cutout"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'post-images'
  AND name = ('transparent-avatars/' || auth.uid()::text || '.png')
  AND owner = auth.uid()
);
