import type { SupabaseClient } from '@supabase/supabase-js';
import { SECURITY_LIMITS } from '@/lib/security-limits';

export const POST_IMAGES_BUCKET = 'post-images';

export type PostImageRow = { id?: string; image_url?: string | null };

function assertSafeStoragePath(path: string): string | null {
  const p = path.trim();
  if (!p || p.includes('..') || p.startsWith('/')) return null;
  if (!p.startsWith('public/')) return null;
  return p;
}

/** Parse a public post image URL into a Supabase Storage object path. */
export function getStoragePathFromPostImageUrl(url: string): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/\/post-images\/(.+)$/);
  if (!match) return null;
  try {
    return assertSafeStoragePath(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function collectStoragePathsFromPosts(posts: PostImageRow[]): string[] {
  const paths = new Set<string>();
  for (const post of posts) {
    const path = getStoragePathFromPostImageUrl(String(post.image_url ?? ''));
    if (path) paths.add(path);
  }
  return [...paths];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type StorageRemoveResult = {
  removed: number;
  failedPaths: string[];
};

/**
 * Best-effort removal of post image objects. Storage failures are logged and returned
 * but do not throw — callers should still delete DB rows to avoid orphan feed entries.
 */
export async function removePostImagesFromStorage(
  admin: SupabaseClient,
  paths: string[],
  options?: {
    onBatchError?: (info: { batch: string[]; message: string }) => void;
  }
): Promise<StorageRemoveResult> {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) return { removed: 0, failedPaths: [] };

  const batchSize = SECURITY_LIMITS.storageRemovePaths;
  let removed = 0;
  const failedPaths: string[] = [];

  for (const batch of chunk(unique, batchSize)) {
    const { error } = await admin.storage.from(POST_IMAGES_BUCKET).remove(batch);
    if (error) {
      options?.onBatchError?.({ batch, message: error.message });
      failedPaths.push(...batch);
      continue;
    }
    removed += batch.length;
  }

  return { removed, failedPaths };
}
