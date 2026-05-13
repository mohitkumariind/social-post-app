import * as ExpoLinking from 'expo-linking';

import { getMockTwitterCampaignAssignment } from '../constants/twitterCampaignMock';
import { isTwitterCampaignAssignmentUuid } from './twitterCampaignAnalytics';

/** Push `data.type` and deep-link host path for Twitter campaign assignments (Phase 3 mock). */
export const PUSH_DATA_TYPE_TWITTER_CAMPAIGN = 'twitter_campaign';

/** In-app route segment (expo-router): `/twitter-campaign`. */
export const TWITTER_CAMPAIGN_ROUTE_SEGMENT = 'twitter-campaign';

/**
 * Deep link examples (scheme from app.json: `socialbot`):
 * - `socialbot://twitter-campaign?assignmentId=mock_assignment_tweet`
 * - `https://example.com/twitter-campaign?assignmentId=mock_assignment_retweet` (if universal links are added later)
 */
export function extractAssignmentIdFromDeepLink(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = ExpoLinking.parse(url);
    const raw = parsed.queryParams?.assignmentId;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && raw[0] != null && String(raw[0]).trim()) return String(raw[0]).trim();

    const path = (parsed.path ?? '').replace(/^\/+/, '');
    if (path === TWITTER_CAMPAIGN_ROUTE_SEGMENT || path.endsWith(`/${TWITTER_CAMPAIGN_ROUTE_SEGMENT}`)) {
      const m = url.match(/[?&]assignmentId=([^&]+)/);
      if (m?.[1]) return decodeURIComponent(m[1]).trim();
    }
  } catch {
    // ignore
  }
  const fallback = url.match(/[?&]assignmentId=([^&]+)/);
  if (fallback?.[1]) return decodeURIComponent(fallback[1]).trim();
  return null;
}

export function getTwitterCampaignAssignmentIdFromPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== PUSH_DATA_TYPE_TWITTER_CAMPAIGN) return null;
  const raw = d.assignment_id ?? d.assignmentId;
  const s = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
  return s || null;
}

/** UUID assignment or known in-app mock id only — blocks arbitrary deep-link / push spoof paths. */
export function isNavigableTwitterCampaignAssignmentId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  const t = id.trim();
  if (!t) return false;
  if (isTwitterCampaignAssignmentUuid(t)) return true;
  return getMockTwitterCampaignAssignment(t) != null;
}
