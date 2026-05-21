/**
 * Shared content targeting visibility (mobile + SQL-aligned).
 * Rules mirror `dashboard_visibility_match` and RBAC `partyOverlap` / state overlap:
 * - All targeting dimensions empty => visible (in-profile global content, NOT admin global targeting)
 * - State must match when content specifies states (0 = wildcard)
 * - Party must match when content specifies parties (empty = all parties within state match)
 */

export type ContentVisibilityProfile = {
  profile_id?: string;
  party_id?: number | null;
  state_id?: number | null;
  loksabha_id?: number | null;
  assembly_id?: number | null;
  group_id?: number | null;
};

export type ContentVisibilityTargeting = {
  party_id?: unknown;
  state_id?: unknown;
  loksabha_id?: unknown;
  assembly_id?: unknown;
  group_id?: unknown;
  profile_ids?: unknown;
};

export type ContentVisibilityResult = {
  ok: boolean;
  reason: string;
};

export function toNumArr(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const n = Number(v);
  return Number.isFinite(n) ? [n] : [];
}

export function toStrArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
}

function normalizeId(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Core targeting match — keep in sync with `dashboard_visibility_match` in Supabase. */
export function contentTargetingMatch(
  profile: ContentVisibilityProfile,
  content: ContentVisibilityTargeting
): ContentVisibilityResult {
  const uProfile = String(profile.profile_id ?? '').trim();
  const uParty = normalizeId(profile.party_id);
  const uState = normalizeId(profile.state_id);
  const uLok = normalizeId(profile.loksabha_id);
  const uAsm = normalizeId(profile.assembly_id);
  const uGroup = normalizeId(profile.group_id);

  if (!uProfile) return { ok: false, reason: 'missing_user_profile_id' };
  if (uParty == null || uState == null) return { ok: false, reason: 'missing_user_party_or_state' };

  const partyIds = toNumArr(content.party_id);
  const stateIds = toNumArr(content.state_id);
  const lokIds = toNumArr(content.loksabha_id);
  const asmIds = toNumArr(content.assembly_id);
  const groupIds = toNumArr(content.group_id);
  const profileIds = toStrArr(content.profile_ids).map((x) => x.trim()).filter(Boolean);

  const isGlobal =
    partyIds.length === 0 &&
    stateIds.length === 0 &&
    lokIds.length === 0 &&
    asmIds.length === 0 &&
    groupIds.length === 0 &&
    profileIds.length === 0;
  if (isGlobal) return { ok: true, reason: 'global_content' };

  const stateMatch =
    stateIds.length === 0 || stateIds.includes(0) || stateIds.includes(uState);
  if (!stateMatch) return { ok: false, reason: 'state_mismatch' };

  const partyMatch =
    partyIds.length === 0 || partyIds.includes(0) || partyIds.includes(uParty);
  if (!partyMatch) return { ok: false, reason: 'party_mismatch' };

  if (lokIds.length > 0 && !lokIds.includes(0)) {
    if (uLok == null || !lokIds.includes(uLok)) return { ok: false, reason: 'loksabha_mismatch' };
  }
  if (asmIds.length > 0 && !asmIds.includes(0)) {
    if (uAsm == null || !asmIds.includes(uAsm)) return { ok: false, reason: 'assembly_mismatch' };
  }
  if (groupIds.length > 0) {
    if (uGroup == null || (!groupIds.includes(0) && !groupIds.includes(uGroup))) {
      return { ok: false, reason: 'group_mismatch' };
    }
  }
  if (profileIds.length > 0 && !profileIds.includes(uProfile)) {
    return { ok: false, reason: 'profile_id_mismatch' };
  }

  return { ok: true, reason: 'ok' };
}

export function canProfileSeeContent(
  profile: ContentVisibilityProfile,
  content: ContentVisibilityTargeting
): boolean {
  return contentTargetingMatch(profile, content).ok;
}
