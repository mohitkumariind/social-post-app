/** Browser calls: admin uploads use service role on the server (Storage RLS blocks JWT uploads). */

export type AdminStorageBucket = 'post-images' | 'user-frames';

export async function adminStorageUpload(
  bucket: AdminStorageBucket,
  path: string,
  file: File | Blob
): Promise<{ publicUrl: string; path: string }> {
  const fd = new FormData();
  fd.append('bucket', bucket);
  fd.append('path', path);
  fd.append('file', file);
  const res = await fetch('/api/admin/storage/upload', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; publicUrl?: string; path?: string };
  if (!res.ok) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  if (!data.publicUrl || !data.path) {
    throw new Error('Upload response missing URL');
  }
  return { publicUrl: data.publicUrl, path: data.path };
}

export async function adminStorageRemove(bucket: AdminStorageBucket, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const res = await fetch('/api/admin/storage/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ bucket, paths }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Remove failed (${res.status})`);
  }
}
