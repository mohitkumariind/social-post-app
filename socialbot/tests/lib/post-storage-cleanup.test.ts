import { describe, expect, it } from 'vitest';
import {
  collectStoragePathsFromPosts,
  getStoragePathFromPostImageUrl,
} from '@/lib/admin/post-storage-cleanup';

describe('post storage cleanup helpers', () => {
  it('parses post-images public URLs', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/public/post-images/public/campaigns/foo.jpg';
    expect(getStoragePathFromPostImageUrl(url)).toBe('public/campaigns/foo.jpg');
  });

  it('rejects unsafe or unrelated paths', () => {
    expect(getStoragePathFromPostImageUrl('')).toBeNull();
    expect(getStoragePathFromPostImageUrl('https://example.com/other-bucket/x')).toBeNull();
    expect(
      getStoragePathFromPostImageUrl(
        'https://example.supabase.co/storage/v1/object/public/post-images/../secret'
      )
    ).toBeNull();
    expect(
      getStoragePathFromPostImageUrl(
        'https://example.supabase.co/storage/v1/object/public/post-images/private/x.jpg'
      )
    ).toBeNull();
  });

  it('deduplicates storage paths from posts', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/public/post-images/public/a.jpg';
    const paths = collectStoragePathsFromPosts([
      { image_url: url },
      { image_url: url },
      { image_url: null },
    ]);
    expect(paths).toEqual(['public/a.jpg']);
  });
});
