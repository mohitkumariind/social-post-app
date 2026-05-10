/**
 * Dashboard content visibility (posts + events).
 * Primary enforcement: Supabase RLS on `posts` / `events` plus RPC
 * `get_dashboard_posts` / `get_dashboard_events` (aliases `*_for_reader`).
 * This module is the secondary client-side safety net; keep rules in sync with SQL.
 */

export type VisibilityExplainResult = {
  ok: boolean;
  reason: string;
  u?: unknown;
  c?: unknown;
};

export function toStrArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
}

export function toNumArr(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const n = Number(v);
  return Number.isFinite(n) ? [n] : [];
}

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

/**
 * @param profileLoaded — whether server profile gate is satisfied (replaces ref snapshot in original).
 */
export function explainVisibility(
  user: Record<string, unknown> | null | undefined,
  content: Record<string, unknown> | null | undefined,
  profileLoaded: boolean
): VisibilityExplainResult {
  const result: VisibilityExplainResult = { ok: false, reason: 'unknown' };
  if (!profileLoaded && !hasUsableProfileForVisibility(user as { profile_id?: string; party_id?: unknown; state_id?: unknown })) {
    result.reason = 'profile_not_loaded';
    return result;
  }

  const uParty = normalizeStrictId(Number(user?.party_id));
  const uState = normalizeStrictId(Number(user?.state_id));
  const uLok = normalizeStrictId(Number(user?.loksabha_id));
  const uAsm = normalizeStrictId(Number(user?.assembly_id));
  const uGroup = normalizeStrictId(user?.group_id);
  const uProfileId = String(user?.profile_id ?? '').trim();

  const partyIds = toNumArr(content?.party_id);
  const stateIds = toNumArr(content?.state_id);
  const lokIds = toNumArr(content?.loksabha_id);
  const asmIds = toNumArr(content?.assembly_id);
  const groupIds = toNumArr(content?.group_id);
  const profileIds = toStrArr(content?.profile_ids)
    .map((x) => String(x).trim())
    .filter(Boolean);

  Object.assign(result, {
    u: { uParty, uState, uLok, uAsm, uGroup, uProfileId },
    c: { partyIds, stateIds, lokIds, asmIds, groupIds, profileIds },
  });

  if (!uProfileId) {
    result.reason = 'missing_user_profile_id';
    return result;
  }
  if (uParty == null || uState == null) {
    result.reason = 'missing_user_party_or_state';
    return result;
  }

  const cParty = content?.party_id;
  const cState = content?.state_id;
  const cLok = content?.loksabha_id;
  const cAsm = content?.assembly_id;
  const cGrp = content?.group_id;
  const cProf = content?.profile_ids;

  if (Array.isArray(cParty) && cParty.length > 0 && partyIds.length === 0) {
    result.reason = 'invalid_party_id_array';
    return result;
  }
  if (Array.isArray(cState) && cState.length > 0 && stateIds.length === 0) {
    result.reason = 'invalid_state_id_array';
    return result;
  }
  if (Array.isArray(cLok) && cLok.length > 0 && lokIds.length === 0) {
    result.reason = 'invalid_loksabha_id_array';
    return result;
  }
  if (Array.isArray(cAsm) && cAsm.length > 0 && asmIds.length === 0) {
    result.reason = 'invalid_assembly_id_array';
    return result;
  }
  if (Array.isArray(cGrp) && cGrp.length > 0 && groupIds.length === 0) {
    result.reason = 'invalid_group_id_array';
    return result;
  }
  if (Array.isArray(cProf) && cProf.length > 0 && profileIds.length === 0) {
    result.reason = 'invalid_profile_ids_array';
    return result;
  }

  const isGlobal =
    partyIds.length === 0 &&
    stateIds.length === 0 &&
    lokIds.length === 0 &&
    asmIds.length === 0 &&
    groupIds.length === 0 &&
    profileIds.length === 0;
  if (isGlobal) {
    result.ok = true;
    result.reason = 'global';
    return result;
  }

  const stateMatch = stateIds.length === 0 ? true : stateIds.includes(0) || stateIds.includes(uState!);
  if (!stateMatch) {
    result.reason = 'state_mismatch';
    return result;
  }
  const partyMatch = partyIds.length === 0 ? true : partyIds.includes(0) || partyIds.includes(uParty!);
  if (!partyMatch) {
    result.reason = 'party_mismatch';
    return result;
  }

  if (lokIds.length > 0 && !lokIds.includes(0)) {
    if (uLok == null) {
      result.reason = 'missing_user_loksabha_id';
      return result;
    }
    if (!lokIds.includes(uLok)) {
      result.reason = 'loksabha_mismatch';
      return result;
    }
  }
  if (asmIds.length > 0 && !asmIds.includes(0)) {
    if (uAsm == null) {
      result.reason = 'missing_user_assembly_id';
      return result;
    }
    if (!asmIds.includes(uAsm)) {
      result.reason = 'assembly_mismatch';
      return result;
    }
  }
  if (groupIds.length > 0) {
    if (uGroup == null) {
      result.reason = 'missing_user_group_id';
      return result;
    }
    if (!groupIds.includes(0) && !groupIds.includes(uGroup)) {
      result.reason = 'group_mismatch';
      return result;
    }
  }
  if (profileIds.length > 0 && !profileIds.includes(uProfileId)) {
    result.reason = 'profile_id_mismatch';
    return result;
  }

  result.ok = true;
  result.reason = 'ok';
  return result;
}

export function canUserSeeContent(
  user: Record<string, unknown> | null | undefined,
  content: Record<string, unknown> | null | undefined,
  profileLoaded: boolean
): boolean {
  return explainVisibility(user, content, profileLoaded).ok;
}
