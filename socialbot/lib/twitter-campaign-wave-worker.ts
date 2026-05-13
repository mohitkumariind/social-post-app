import type { SupabaseClient } from '@supabase/supabase-js';

export type TwitterWaveRow = {
  id: string;
  campaign_id: string;
  wave_index: number;
  scheduled_at: string;
  status: string;
  locked_at: string | null;
  locked_by: string | null;
  attempt_count: number | null;
  lock_token: string | null;
  staging_after_user_id: string | null;
  started_at: string | null;
};

export type TwitterCampaignTargetRow = {
  id: string;
  status: string;
  target_party: string;
  type: string;
};

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Profile IDs per page when staging wave batches (default 500). */
export function resolveTwitterWaveUserPageSize(): number {
  return intFromEnv('TWITTER_WAVE_USER_PAGE_SIZE', 500, 50, 5000);
}

/** Max batch rows inserted per wave per HTTP invocation (default 40 ≈ 20k users). */
export function resolveTwitterWaveMaxBatchesPerRun(): number {
  return intFromEnv('TWITTER_WAVE_MAX_BATCHES_PER_RUN', 40, 1, 200);
}

export function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
}

/**
 * Keyset page of profile ids for a campaign party slug (case-insensitive match on profiles.party).
 * Does not implement unseen / dedupe — infrastructure only.
 */
export async function fetchEligibleProfileIdsPage(
  admin: SupabaseClient,
  targetPartySlug: string,
  opts: { afterUserId: string | null; limit: number }
): Promise<{ ids: string[]; nextAfter: string | null }> {
  const slug = String(targetPartySlug ?? '').trim();
  const limit = Math.max(1, opts.limit);
  if (!slug) return { ids: [], nextAfter: null };

  let q = admin.from('profiles').select('id').order('id', { ascending: true }).limit(limit + 1);
  q = q.ilike('party', slug);
  if (opts.afterUserId) q = q.gt('id', opts.afterUserId);

  const { data, error } = await q;
  if (error) {
    if (isMissingColumnErr(error, 'party')) {
      return { ids: [], nextAfter: null };
    }
    throw new Error(error.message);
  }
  const rows = (data ?? []) as { id: string }[];
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const ids = slice.map((r) => String(r.id)).filter(Boolean);
  const nextAfter = hasMore ? ids[ids.length - 1]! : null;
  return { ids, nextAfter };
}

export async function loadCampaignForWave(
  admin: SupabaseClient,
  campaignId: string
): Promise<TwitterCampaignTargetRow | null> {
  const { data, error } = await admin
    .from('twitter_campaigns')
    .select('id,status,target_party,type')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TwitterCampaignTargetRow) ?? null;
}

export async function nextWaveBatchIndex(admin: SupabaseClient, waveId: string): Promise<number> {
  const { data, error } = await admin
    .from('twitter_campaign_wave_batches')
    .select('batch_index')
    .eq('wave_id', waveId)
    .order('batch_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const msg = String(error.message ?? '').toLowerCase();
    if (msg.includes('twitter_campaign_wave_batches') && (msg.includes('does not exist') || msg.includes('schema cache'))) {
      return 1;
    }
    throw new Error(error.message);
  }
  const max = Number((data as { batch_index?: number } | null)?.batch_index ?? 0);
  return Number.isFinite(max) && max > 0 ? max + 1 : 1;
}
