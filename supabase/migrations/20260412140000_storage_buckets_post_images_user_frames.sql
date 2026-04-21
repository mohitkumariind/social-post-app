-- Storage: public buckets + RLS for post-images and user-frames.
--
-- Bucket names MUST match the app:
--   socialbot/lib/admin-storage-client.ts → 'post-images' | 'user-frames'
--   socialbot/app/api/admin/storage/upload/route.ts and remove/route.ts → same set
-- You asked for a bucket named "frames"; the codebase uses "user-frames" (user-uploaded
-- frame overlays). If you create only "frames", admin uploads will fail until you
-- rename buckets or update those files to use 'frames'.

-- Buckets (public = anyone can read via public object URL; RLS still governs storage API)
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-images', 'post-images', true)
ON CONFLICT (id) DO UPDATE SET public = excluded.public, name = excluded.name;

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-frames', 'user-frames', true)
ON CONFLICT (id) DO UPDATE SET public = excluded.public, name = excluded.name;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Replace policies if this migration is re-applied
DROP POLICY IF EXISTS "storage_select_public_post_images_user_frames" ON storage.objects;
DROP POLICY IF EXISTS "storage_insert_admin_post_images_user_frames" ON storage.objects;
DROP POLICY IF EXISTS "storage_update_admin_post_images_user_frames" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_admin_post_images_user_frames" ON storage.objects;

-- Anyone (anon + authenticated) can list/read objects in these buckets via the Storage API
CREATE POLICY "storage_select_public_post_images_user_frames"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id IN ('post-images', 'user-frames'));

-- Only authenticated users whose profile role is admin may upload
CREATE POLICY "storage_insert_admin_post_images_user_frames"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('post-images', 'user-frames')
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(trim(COALESCE(p.role, ''))) = 'admin'
  )
);

CREATE POLICY "storage_update_admin_post_images_user_frames"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('post-images', 'user-frames')
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(trim(COALESCE(p.role, ''))) = 'admin'
  )
)
WITH CHECK (
  bucket_id IN ('post-images', 'user-frames')
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(trim(COALESCE(p.role, ''))) = 'admin'
  )
);

CREATE POLICY "storage_delete_admin_post_images_user_frames"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id IN ('post-images', 'user-frames')
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(trim(COALESCE(p.role, ''))) = 'admin'
  )
);
