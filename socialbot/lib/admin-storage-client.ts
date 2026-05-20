/** Browser calls: admin uploads use service role on the server (Storage RLS blocks JWT uploads). */

export type AdminStorageBucket = 'post-images' | 'user-frames';

export async function adminStorageUpload(
  bucket: AdminStorageBucket,
  path: string,
  file: File | Blob
): Promise<{ publicUrl: string; path: string }> {
  return adminStorageUploadWithProgress(bucket, path, file);
}

export type AdminStorageUploadProgressOptions = {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

/** XHR upload so the browser can report `upload.onprogress` (fetch cannot). Same API route as `adminStorageUpload`. */
export function adminStorageUploadWithProgress(
  bucket: AdminStorageBucket,
  path: string,
  file: File | Blob,
  options?: AdminStorageUploadProgressOptions
): Promise<{ publicUrl: string; path: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('bucket', bucket);
    fd.append('path', path);
    fd.append('file', file);

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.upload.addEventListener('progress', (ev) => {
      if (!ev.lengthComputable || !options?.onProgress) return;
      const pct = Math.min(100, Math.max(0, Math.round((ev.loaded / ev.total) * 100)));
      options.onProgress(pct);
    });

    xhr.addEventListener('load', () => {
      options?.signal?.removeEventListener('abort', onAbort);
      let data: { error?: string; publicUrl?: string; path?: string } = {};
      try {
        data = JSON.parse(xhr.responseText || '{}') as typeof data;
      } catch {
        data = {};
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.error || `Upload failed (${xhr.status})`));
        return;
      }
      if (!data.publicUrl || !data.path) {
        reject(new Error('Upload response missing URL'));
        return;
      }
      resolve({ publicUrl: data.publicUrl, path: data.path });
    });

    xhr.addEventListener('error', () => {
      options?.signal?.removeEventListener('abort', onAbort);
      reject(new Error('Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      options?.signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Upload cancelled', 'AbortError'));
    });

    xhr.open('POST', '/api/admin/storage/upload');
    xhr.withCredentials = true;
    xhr.send(fd);
  });
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
