import { supabase } from './supabase';

const POST_IMAGES_BUCKET = 'post-images';
const CUTOUT_LOG = '[CutoutCache]';

export function getTransparentCutoutObjectPath(userId: string): string {
  return `transparent-avatars/${userId}.png`;
}

export async function postImagesObjectExists(objectPath: string): Promise<boolean> {
  const folder = objectPath.includes('/') ? objectPath.slice(0, objectPath.lastIndexOf('/')) : '';
  const fileName = objectPath.includes('/') ? objectPath.slice(objectPath.lastIndexOf('/') + 1) : objectPath;
  const searchPrefix = fileName.replace(/\.png$/i, '') || fileName;
  const { data, error } = await supabase.storage.from(POST_IMAGES_BUCKET).list(folder, {
    limit: 100,
    search: searchPrefix,
  });
  if (error) {
    if (__DEV__) console.log(CUTOUT_LOG, 'list miss:', error.message);
    return false;
  }
  return (data ?? []).some((f) => f.name === fileName);
}

export function getCutoutPublicUrl(objectPath: string): string {
  const { data } = supabase.storage.from(POST_IMAGES_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
