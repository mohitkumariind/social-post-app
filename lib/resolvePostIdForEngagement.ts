import { supabase } from './supabase';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Route param post id when present and valid. */
export function postIdFromRouteParam(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return UUID_RE.test(s) ? s : '';
}

/**
 * Resolve post UUID for download analytics when navigation omitted `postId`
 * (e.g. deep link with image only). Best-effort; returns '' on miss.
 */
export async function resolvePostIdForEngagement(opts: {
  routePostId: unknown;
  imageUrl: string;
}): Promise<string> {
  const fromRoute = postIdFromRouteParam(opts.routePostId);
  if (fromRoute) return fromRoute;

  const url = String(opts.imageUrl ?? '').trim();
  if (!url) return '';

  try {
    const { data, error } = await supabase
      .from('posts')
      .select('id')
      .eq('image_url', url)
      .limit(1)
      .maybeSingle();
    if (error || !data) return '';
    return postIdFromRouteParam((data as { id?: unknown }).id);
  } catch {
    return '';
  }
}
