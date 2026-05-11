import { supabase } from '../lib/supabase';
import { gfxLogCapped } from '../utils/dashboardDebug';
import { explainVisibility } from '../utils/visibility';

export type DashboardPostRow = {
  id: string;
  title: string;
  image_url: string;
  category: string;
  dashboard_category?: string | null;
  event_date?: string;
  download_count?: number | null;
  state_id?: number[] | number | null;
  loksabha_id?: number[] | number | null;
  assembly_id?: number[] | number | null;
  party_id?: number[] | number | null;
  group_id?: number[] | number | null;
  profile_ids?: string[] | string | null;
  captions?: string | string[];
};

export type FetchPostsResult = { rows: DashboardPostRow[]; error: string | null; usedRpc: boolean };

function rpcMissingFunction(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? '');
  const code = String((err as { code?: string })?.code ?? '');
  return (
    code === '42883' ||
    msg.includes('does not exist') ||
    msg.includes('Could not find the function') ||
    msg.includes('schema cache')
  );
}

/**
 * Secondary defense: drop any row that still fails client visibility (must match server; log in dev).
 */
function applySecondaryPostFilter(
  rows: DashboardPostRow[],
  userSnapshot: Record<string, unknown>,
  profileLoaded: boolean
): DashboardPostRow[] {
  const kept: DashboardPostRow[] = [];
  let firstReject: ReturnType<typeof explainVisibility> | null = null;
  for (const p of rows) {
    const ex = explainVisibility(userSnapshot, p as Record<string, unknown>, profileLoaded);
    if (ex.ok) kept.push(p);
    else if (!firstReject) firstReject = ex;
  }
  if (__DEV__ && kept.length !== rows.length) {
    gfxLogCapped('rpcSecondaryStrip', { raw: rows.length, kept: kept.length, firstReason: firstReject }, 4);
  }
  return kept;
}

/**
 * Dashboard posts: server-enforced via `get_dashboard_posts` RPC + RLS.
 * Never falls back to broad `posts` table SELECT (unauthorized rows must not be downloadable).
 */
export async function fetchDashboardPosts(opts: {
  profileLoaded: boolean;
  userSnapshot: Record<string, unknown>;
  postsSchemaOk: boolean | null;
  onPostsSchemaMissing?: () => void;
  dashboardCategory?: string | null;
}): Promise<FetchPostsResult> {
  if (opts.postsSchemaOk === false) {
    return { rows: [], error: null, usedRpc: true };
  }

  // v2 supports optional quick-category filtering.
  const dc = opts.dashboardCategory != null && String(opts.dashboardCategory).trim() !== '' ? String(opts.dashboardCategory).trim() : null;
  let rpc = await supabase.rpc('get_dashboard_posts_v2', { p_dashboard_category: dc });
  if (rpc.error && rpcMissingFunction(rpc.error)) {
    rpc = await supabase.rpc('get_dashboard_posts_for_reader_v2', { p_dashboard_category: dc });
  }
  if (rpc.error && rpcMissingFunction(rpc.error)) {
    // Legacy fallback (no category filtering available).
    rpc = await supabase.rpc('get_dashboard_posts');
  }
  if (rpc.error && rpcMissingFunction(rpc.error)) {
    rpc = await supabase.rpc('get_dashboard_posts_for_reader');
  }

  if (rpc.error) {
    const msg = String(rpc.error.message ?? 'Failed to load posts');
    if (msg.includes('does not exist') && opts.onPostsSchemaMissing) {
      opts.onPostsSchemaMissing();
    }
    return { rows: [], error: msg, usedRpc: true };
  }

  if (!Array.isArray(rpc.data)) {
    return { rows: [], error: 'Invalid response from get_dashboard_posts', usedRpc: true };
  }

  const rows = rpc.data as DashboardPostRow[];
  const filtered = applySecondaryPostFilter(rows, opts.userSnapshot, opts.profileLoaded);
  return { rows: filtered, error: null, usedRpc: true };
}

