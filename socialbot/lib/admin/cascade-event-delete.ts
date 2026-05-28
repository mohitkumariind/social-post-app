import type { SupabaseClient } from '@supabase/supabase-js';
import {
  collectStoragePathsFromPosts,
  removePostImagesFromStorage,
  type PostImageRow,
} from '@/lib/admin/post-storage-cleanup';

export type LinkedPostRow = PostImageRow & { id: string };

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column') || msg.includes('schema cache'));
}

/** Load posts linked by `event_id` and/or legacy `category` = event name. */
export async function loadPostsLinkedToEvent(
  admin: SupabaseClient,
  eventId: string,
  eventName: string
): Promise<{ posts: LinkedPostRow[]; error: string | null }> {
  const byId = new Map<string, LinkedPostRow>();
  const id = eventId.trim();
  const name = eventName.trim();

  if (id) {
    const byEventId = await admin.from('posts').select('id, image_url').eq('event_id', id);
    if (byEventId.error) {
      if (!isMissingColumnErr(byEventId.error, 'event_id')) {
        return { posts: [], error: byEventId.error.message };
      }
    } else {
      for (const row of byEventId.data ?? []) {
        const postId = String((row as { id?: unknown }).id ?? '').trim();
        if (!postId) continue;
        byId.set(postId, {
          id: postId,
          image_url: (row as { image_url?: string | null }).image_url ?? null,
        });
      }
    }
  }

  if (name) {
    const byCategory = await admin.from('posts').select('id, image_url').eq('category', name);
    if (byCategory.error) return { posts: [], error: byCategory.error.message };
    for (const row of byCategory.data ?? []) {
      const postId = String((row as { id?: unknown }).id ?? '').trim();
      if (!postId) continue;
      byId.set(postId, {
        id: postId,
        image_url: (row as { image_url?: string | null }).image_url ?? null,
      });
    }
  }

  return { posts: [...byId.values()], error: null };
}

export type CascadeDeletePostsResult =
  | {
      ok: true;
      postsDeleted: number;
      storageRemoved: number;
      storageFailed: string[];
    }
  | {
      ok: false;
      error: string;
      postsDeleted: number;
      storageRemoved: number;
      storageFailed: string[];
    };

/**
 * Delete all posts (and their storage assets) linked to an event.
 * Order: load → storage (best-effort) → hard-delete post rows.
 */
export async function cascadeDeletePostsForEvent(
  admin: SupabaseClient,
  eventId: string,
  eventName: string,
  options?: {
    logStorageFailure?: (info: { eventId: string; batch: string[]; message: string }) => void;
  }
): Promise<CascadeDeletePostsResult> {
  const empty = { postsDeleted: 0, storageRemoved: 0, storageFailed: [] as string[] };

  const { posts, error: loadErr } = await loadPostsLinkedToEvent(admin, eventId, eventName);
  if (loadErr) return { ok: false, error: loadErr, ...empty };

  const paths = collectStoragePathsFromPosts(posts);
  const storage = await removePostImagesFromStorage(admin, paths, {
    onBatchError: ({ batch, message }) => {
      options?.logStorageFailure?.({ eventId, batch, message });
    },
  });

  const ids = posts.map((p) => p.id).filter(Boolean);
  if (ids.length > 0) {
    const { error: delErr } = await admin.from('posts').delete().in('id', ids);
    if (delErr) {
      return {
        ok: false,
        error: delErr.message,
        postsDeleted: 0,
        storageRemoved: storage.removed,
        storageFailed: storage.failedPaths,
      };
    }
  }

  return {
    ok: true,
    postsDeleted: ids.length,
    storageRemoved: storage.removed,
    storageFailed: storage.failedPaths,
  };
}
