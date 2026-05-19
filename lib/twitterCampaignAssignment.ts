import { supabase } from './supabase';
import { isTwitterCampaignAssignmentUuid } from './twitterCampaignAnalytics';

export type TwitterCampaignKind = 'tweet' | 'retweet';

export type TwitterCampaignAssignmentView = {
  id: string;
  kind: TwitterCampaignKind;
  campaignTitle: string;
  campaignStatus: string;
  assignmentStatus: string;
  actionable: boolean;
  unavailableReason: string | null;
  tweetText: string;
  imageUrl: string | null;
  tweetUrl: string;
  hashtags: string[];
  note: string | null;
};

export type FetchTwitterCampaignAssignmentResult =
  | { ok: true; assignment: TwitterCampaignAssignmentView }
  | { ok: false; error: 'not_authenticated' | 'invalid_id' | 'not_found' | 'forbidden' | 'network' | 'unknown'; message?: string };

function mapRpcError(message: string): FetchTwitterCampaignAssignmentResult['error'] {
  const m = message.toLowerCase();
  if (m.includes('not_authenticated')) return 'not_authenticated';
  if (m.includes('assignment_not_found') || m.includes('campaign_not_found') || m.includes('variant_not_found')) {
    return 'not_found';
  }
  if (m.includes('forbidden')) return 'forbidden';
  if (m.includes('invalid_assignment')) return 'invalid_id';
  if (m.includes('fetch') || m.includes('network') || m.includes('timeout') || m.includes('failed to connect')) {
    return 'network';
  }
  return 'unknown';
}

/** Extract #tags from variant note, or comma/space-separated tokens without #. */
export function parseVariantHashtags(note: string | null | undefined): string[] {
  const raw = String(note ?? '').trim();
  if (!raw) return [];
  const hashTags = raw.match(/#[\p{L}\p{N}_]+/gu);
  if (hashTags && hashTags.length > 0) {
    return [...new Set(hashTags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean))];
  }
  return [...new Set(raw.split(/[,\n]+/).map((s) => s.trim().replace(/^#/, '')).filter(Boolean))];
}

export function buildTwitterWebIntentTweetUrl(args: { text: string; hashtags: string[] }): string {
  const tagLine = args.hashtags
    .map((h) => {
      const t = String(h).trim();
      if (!t) return '';
      return t.startsWith('#') ? t : `#${t}`;
    })
    .filter(Boolean)
    .join(' ');
  const combined = [args.text.trim(), tagLine].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({ text: combined });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function normalizeRpcRow(row: Record<string, unknown>): TwitterCampaignAssignmentView | null {
  const assignmentId = String(row.assignment_id ?? '').trim();
  const campaignType = String(row.campaign_type ?? '').trim();
  if (!assignmentId || (campaignType !== 'tweet' && campaignType !== 'retweet')) return null;

  const note = row.note != null ? String(row.note) : null;
  const hashtags = parseVariantHashtags(note);

  return {
    id: assignmentId,
    kind: campaignType,
    campaignTitle: String(row.campaign_title ?? 'Campaign').trim() || 'Campaign',
    campaignStatus: String(row.campaign_status ?? '').trim(),
    assignmentStatus: String(row.assignment_status ?? '').trim(),
    actionable: row.actionable === true,
    unavailableReason: row.unavailable_reason != null ? String(row.unavailable_reason) : null,
    tweetText: String(row.tweet_text ?? '').trim(),
    imageUrl: row.image_url != null && String(row.image_url).trim() ? String(row.image_url).trim() : null,
    tweetUrl: String(row.tweet_url ?? '').trim(),
    hashtags,
    note,
  };
}

export async function fetchTwitterCampaignAssignment(
  assignmentId: string
): Promise<FetchTwitterCampaignAssignmentResult> {
  const id = String(assignmentId ?? '').trim();
  if (!id) return { ok: false, error: 'invalid_id' };
  if (!isTwitterCampaignAssignmentUuid(id)) {
    return { ok: false, error: 'invalid_id' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) {
    return { ok: false, error: 'not_authenticated' };
  }

  const { data, error } = await supabase.rpc('twitter_campaign_get_assignment', {
    p_assignment_id: id,
  });

  if (error) {
    return { ok: false, error: mapRpcError(error.message), message: error.message };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'unknown', message: 'Invalid assignment payload' };
  }

  const assignment = normalizeRpcRow(data as Record<string, unknown>);
  if (!assignment) {
    return { ok: false, error: 'unknown', message: 'Malformed assignment payload' };
  }

  return { ok: true, assignment };
}
