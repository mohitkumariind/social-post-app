import { supabase } from './supabase';

export type LeaderboardEntry = {
  leader_rank: number;
  profile_id: string;
  display_name: string;
  avatar_url: string;
  instagram: string;
  points: number;
};

/** Scopes map to server-side filters derived only from `auth.uid()` profile — never from client-supplied party/state. */
export type LeaderboardScope = 'state' | 'national';

/** Profile slice for typing callers; never sent as party/state filters (server uses JWT only). */
export type LeaderboardUserContext = {
  profile_id: string;
  party_id: number | null;
  state_id: number | null;
};

const DEFAULT_STATE_LIMIT = 50;
const DEFAULT_NATIONAL_LIMIT = 10;

function mapRpcRows(data: unknown): LeaderboardEntry[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: Record<string, unknown>) => ({
    leader_rank: Number(r.leader_rank ?? 0),
    profile_id: String(r.profile_id ?? ''),
    display_name: String(r.display_name ?? ''),
    avatar_url: String(r.avatar_url ?? ''),
    instagram: String(r.instagram ?? ''),
    points: Number(r.points ?? 0),
  }));
}

function clampLimit(scope: LeaderboardScope, limit: number): number {
  if (scope === 'state') {
    return Math.min(Math.max(limit, 1), 100);
  }
  return Math.min(Math.max(limit, 1), 50);
}

/**
 * Production leaderboard fetch: sends only `scope` and `p_limit`.
 * Party/state scoping is enforced in `public.get_leaderboard` via `auth.uid()` — never trust client filters.
 */
export async function getLeaderboard(
  scope: LeaderboardScope,
  user: LeaderboardUserContext,
  limit?: number
): Promise<{ rows: LeaderboardEntry[]; error: string | null }> {
  if (!user.profile_id?.trim()) {
    return { rows: [], error: 'Not signed in.' };
  }

  const rawLimit =
    scope === 'state' ? limit ?? DEFAULT_STATE_LIMIT : limit ?? DEFAULT_NATIONAL_LIMIT;
  const p_limit = clampLimit(scope, rawLimit);

  const { data, error } = await supabase.rpc('get_leaderboard', {
    p_scope: scope,
    p_limit,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: mapRpcRows(data), error: null };
}

/** Strip @, URLs; return handle or null (hide icon when null). */
export function sanitizeInstagramHandle(raw: unknown): string | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/^@+/g, '').replace(/\s+/g, '');
  const urlMatch = s.match(/instagram\.com\/([^/?#\s]+)/i);
  if (urlMatch?.[1]) s = urlMatch[1].trim();
  s = s.split('/')[0].split('?')[0].trim();
  s = s.replace(/^@+/g, '');
  const cleaned = s.replace(/[^a-zA-Z0-9._]/g, '');
  if (cleaned.length < 2) return null;
  return cleaned;
}

export function formatPointsLabel(n: number): string {
  const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );
  return `${num} Points`;
}
