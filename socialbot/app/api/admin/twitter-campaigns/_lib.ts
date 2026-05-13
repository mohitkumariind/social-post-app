import { NextRequest } from 'next/server';
import { normalizePartyId } from '@/lib/constants';

export const TWITTER_CAMPAIGN_RESOURCE = 'twitter_campaigns' as const;

export type TwitterCampaignType = 'tweet' | 'retweet';

export type TwitterCampaignRow = {
  id: string;
  title: string;
  type: TwitterCampaignType;
  total_waves: number;
  gap_minutes: number;
  scheduled_at: string | null;
  target_party: string;
  description: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  max_push_per_user_per_day?: number;
  points_share?: number;
  points_retweet?: number;
  points_participation?: number;
};

export type TwitterCampaignVariantRow = {
  id: string;
  campaign_id: string;
  variant_index: number;
  text: string | null;
  image_url: string | null;
  tweet_url: string | null;
  note: string | null;
  created_at: string;
};

export type TwitterCampaignWaveRow = {
  id: string;
  campaign_id: string;
  wave_index: number;
  scheduled_at: string;
  status: string;
  created_at: string;
};

export type VariantInput = {
  variant_index?: number;
  text?: string | null;
  image_url?: string | null;
  tweet_url?: string | null;
  note?: string | null;
};

export function parseScheduledAt(v: unknown): { ok: true; iso: string | null } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, iso: null };
  if (v == null || String(v).trim() === '') return { ok: true, iso: null };
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid scheduled_at' };
  return { ok: true, iso: d.toISOString() };
}

export function normalizeVariantsInput(raw: unknown): VariantInput[] | { error: string } {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: 'variants must be an array' };
  const out: VariantInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { error: 'invalid variant row' };
    const o = item as Record<string, unknown>;
    out.push({
      variant_index: o.variant_index != null ? Number(o.variant_index) : undefined,
      text: o.text !== undefined ? (o.text == null ? null : String(o.text)) : undefined,
      image_url: o.image_url !== undefined ? (o.image_url == null ? null : String(o.image_url)) : undefined,
      tweet_url: o.tweet_url !== undefined ? (o.tweet_url == null ? null : String(o.tweet_url)) : undefined,
      note: o.note !== undefined ? (o.note == null ? null : String(o.note)) : undefined,
    });
  }
  for (const v of out) {
    if (v.variant_index != null && (!Number.isFinite(v.variant_index) || v.variant_index < 1)) {
      return { error: 'variant_index must be a positive integer' };
    }
  }
  return out;
}

export function normalizeTargetParty(raw: unknown): string | { error: string } {
  const s = normalizePartyId(String(raw ?? '').trim());
  if (!s) return { error: 'target_party is required' };
  return s;
}

export function parseCampaignType(raw: unknown): TwitterCampaignType | { error: string } {
  const t = String(raw ?? '').trim();
  if (t === 'tweet' || t === 'retweet') return t;
  return { error: 'type must be tweet or retweet' };
}

export function variantsToJsonb(variants: VariantInput[]): unknown[] {
  return variants.map((v) => ({
    variant_index: v.variant_index ?? null,
    text: v.text ?? null,
    image_url: v.image_url ?? null,
    tweet_url: v.tweet_url ?? null,
    note: v.note ?? null,
  }));
}

/** Path: `/api/admin/twitter-campaigns/:id` or `.../:id/publish`. */
export function twitterCampaignIdFromRequest(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const i = segments.indexOf('twitter-campaigns');
  if (i < 0) return '';
  return String(segments[i + 1] ?? '').trim();
}
