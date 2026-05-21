/**
 * Dashboard content visibility (posts + events).
 * Delegates to shared `lib/rbac/content-visibility` (aligned with SQL `dashboard_visibility_match`).
 */

import {
  contentTargetingMatch,
  canProfileSeeContent,
  type ContentVisibilityProfile,
  type ContentVisibilityResult,
  type ContentVisibilityTargeting,
} from '../lib/rbac/content-visibility';

export type VisibilityExplainResult = ContentVisibilityResult & {
  u?: unknown;
  c?: unknown;
};

export { toNumArr, toStrArr } from '../lib/rbac/content-visibility';

export function normalizeStrictId(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasUsableProfileForVisibility(u: {
  profile_id?: string;
  party_id?: number | null;
  state_id?: number | null;
}): boolean {
  const profileId = String(u?.profile_id ?? '').trim();
  const partyId = typeof u?.party_id === 'number' ? u.party_id : u?.party_id != null ? Number(u.party_id) : null;
  const stateId = typeof u?.state_id === 'number' ? u.state_id : u?.state_id != null ? Number(u.state_id) : null;
  return !!profileId && Number.isFinite(partyId as number) && Number.isFinite(stateId as number);
}

export function toVisibilityUserSlice(user: Record<string, unknown> | null | undefined): ContentVisibilityProfile {
  if (user == null) return {};
  return {
    profile_id: user.profile_id != null ? String(user.profile_id) : undefined,
    party_id: normalizeStrictId(user.party_id),
    state_id: normalizeStrictId(user.state_id),
    loksabha_id: normalizeStrictId(user.loksabha_id),
    assembly_id: normalizeStrictId(user.assembly_id),
    group_id: normalizeStrictId(user.group_id),
  };
}

export function explainVisibility(
  user: Record<string, unknown> | null | undefined,
  content: Record<string, unknown> | null | undefined,
  profileLoaded: boolean
): VisibilityExplainResult {
  if (!profileLoaded && !hasUsableProfileForVisibility(toVisibilityUserSlice(user))) {
    return { ok: false, reason: 'profile_not_loaded' };
  }

  const profile = toVisibilityUserSlice(user);
  const targeting: ContentVisibilityTargeting = {
    party_id: content?.party_id,
    state_id: content?.state_id,
    loksabha_id: content?.loksabha_id,
    assembly_id: content?.assembly_id,
    group_id: content?.group_id,
    profile_ids: content?.profile_ids,
  };

  const result = contentTargetingMatch(profile, targeting);
  return {
    ...result,
    u: profile,
    c: targeting,
  };
}

export function canUserSeeContent(
  user: Record<string, unknown> | null | undefined,
  content: Record<string, unknown> | null | undefined,
  profileLoaded: boolean
): boolean {
  if (!profileLoaded && !hasUsableProfileForVisibility(toVisibilityUserSlice(user))) {
    return false;
  }
  return canProfileSeeContent(toVisibilityUserSlice(user), {
    party_id: content?.party_id,
    state_id: content?.state_id,
    loksabha_id: content?.loksabha_id,
    assembly_id: content?.assembly_id,
    group_id: content?.group_id,
    profile_ids: content?.profile_ids,
  });
}
