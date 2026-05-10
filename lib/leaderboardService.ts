import { supabase } from './supabase';

export type LeaderboardEntry = {
  leader_rank: number;
  profile_id: string;
  display_name: string;
  avatar_url: string;
  instagram: string;
  points: number;
};

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

export async function fetchStatePartyLeaderboard(limit = 50): Promise<{
  rows: LeaderboardEntry[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc('get_leaderboard_state_party', { p_limit: limit });
  if (error) return { rows: [], error: error.message };
  return { rows: mapRpcRows(data), error: null };
}

export async function fetchNationalPartyLeaderboard(limit = 10): Promise<{
  rows: LeaderboardEntry[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc('get_leaderboard_national_party', { p_limit: limit });
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
