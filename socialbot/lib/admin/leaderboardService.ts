import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { isAdmin, isCampaignManager, isModerator } from '@/lib/admin-gate';
import { parseGroupIds } from '@/lib/rbac/require';
import { resolveEffectiveGroupIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, clampLimit } from '@/lib/perf-defaults';

export type AdminLeaderboardRow = {
  rank: number;
  profile_id: string;
  name: string;
  state: string;
  party: string;
  group_id: number | null;
  group_name: string;
  points: number;
  last_active: string | null;
  phone: string | null;
};

export type AdminLeaderboardKpis = {
  total_users: number;
  total_points: number;
  top_state_name: string | null;
  top_state_points: number;
  top_group_name: string | null;
  top_group_points: number;
  avg_points_per_user: number;
};

export type AdminLeaderboardResult = {
  rows: AdminLeaderboardRow[];
  kpis: AdminLeaderboardKpis;
  total_matching: number;
};

export type AdminLeaderboardFilters = {
  search: string;
  /** Admin-only extra filter; ignored for moderator/CM at API layer. */
  stateId: number | null;
  party: string;
  groupId: number | null;
  dateFrom: Date;
  dateTo: Date;
  offset: number;
  limit: number;
};

export const ADMIN_LB_EXPORT_MAX_ROWS = 10_000;
export const ADMIN_LB_MAX_OFFSET = 50_000;

function toCmNumericGroupIds(assignedGroupIds: string[]): number[] {
  const parsed = parseGroupIds(assignedGroupIds);
  if (parsed.malformed) return [];
  return parsed.ids
    .map((x) => Number(x))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function mapRpcRow(r: Record<string, unknown>, rankFallback: number): AdminLeaderboardRow {
  return {
    rank: Number(r.rank ?? rankFallback),
    profile_id: String(r.profile_id ?? ''),
    name: String(r.name ?? ''),
    state: String(r.state ?? ''),
    party: String(r.party ?? ''),
    group_id: r.group_id == null ? null : Number(r.group_id),
    group_name: String(r.group_name ?? ''),
    points: Number(r.points ?? 0),
    last_active: r.last_active == null ? null : String(r.last_active),
    phone: r.phone == null ? null : String(r.phone),
  };
}

function parseRpcBundle(data: unknown): AdminLeaderboardResult | { error: string } {
  if (data == null || typeof data !== 'object') return { error: 'Empty leaderboard response' };
  const o = data as Record<string, unknown>;
  const rowsRaw = o.rows;
  const kpisRaw = o.kpis;
  const total_matching = Number(o.total_matching ?? 0);
  if (!kpisRaw || typeof kpisRaw !== 'object') return { error: 'Invalid KPI payload' };
  const k = kpisRaw as Record<string, unknown>;
  const kpis: AdminLeaderboardKpis = {
    total_users: Number(k.total_users ?? 0),
    total_points: Number(k.total_points ?? 0),
    top_state_name: k.top_state_name == null ? null : String(k.top_state_name),
    top_state_points: Number(k.top_state_points ?? 0),
    top_group_name: k.top_group_name == null ? null : String(k.top_group_name),
    top_group_points: Number(k.top_group_points ?? 0),
    avg_points_per_user: Number(k.avg_points_per_user ?? 0),
  };
  if (!Array.isArray(rowsRaw)) return { error: 'Invalid rows payload' };
  const rows = rowsRaw.map((row, i) => mapRpcRow(row as Record<string, unknown>, i + 1));
  return { rows, kpis, total_matching };
}

/**
 * Validates URL-driven filters against RBAC. Never trust client scope — caller must pass session-derived auth.
 */
export function assertLeaderboardFiltersAllowed(
  auth: Pick<VerifiedAdminAuth, 'role' | 'assigned_state_ids' | 'assigned_group_ids'>,
  filters: Pick<AdminLeaderboardFilters, 'stateId' | 'party' | 'groupId'>,
  opts?: { cmAllowedNumericGroupIds?: number[] }
): { ok: true } | { ok: false; message: string; status: number } {
  if (isModerator(auth)) {
    if (filters.party.trim()) {
      return { ok: false, message: 'Forbidden: party filter not allowed for moderator', status: 403 };
    }
    if (filters.stateId != null) {
      const ok = auth.assigned_state_ids.some((x) => Number(x) === Number(filters.stateId));
      if (!ok) return { ok: false, message: 'Forbidden: state filter outside assigned states', status: 403 };
    }
    if (filters.groupId != null) {
      return { ok: false, message: 'Forbidden: group filter not allowed for moderator', status: 403 };
    }
  }
  if (isCampaignManager(auth)) {
    if (filters.stateId != null) {
      return { ok: false, message: 'Forbidden: state filter not allowed for campaign manager', status: 403 };
    }
    if (filters.party.trim()) {
      return { ok: false, message: 'Forbidden: party filter not allowed for campaign manager', status: 403 };
    }
    if (filters.groupId != null) {
      const g = Number(filters.groupId);
      const allowed =
        Array.isArray(opts?.cmAllowedNumericGroupIds) && opts.cmAllowedNumericGroupIds.length > 0
          ? opts.cmAllowedNumericGroupIds
          : toCmNumericGroupIds(auth.assigned_group_ids);
      if (!allowed.includes(g)) {
        return { ok: false, message: 'Forbidden: group filter outside assigned groups', status: 403 };
      }
    }
  }
  return { ok: true };
}

export async function fetchAdminLeaderboardPage(
  admin: SupabaseClient,
  auth: VerifiedAdminAuth,
  filters: AdminLeaderboardFilters,
  cmEffectiveGroupIds: string[] | null
): Promise<AdminLeaderboardResult | { error: string }> {
  const mode = auth.role;
  const moderatorStates = isModerator(auth)
    ? auth.assigned_state_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : [];
  const cmGroups = isCampaignManager(auth)
    ? toCmNumericGroupIds(
        cmEffectiveGroupIds && cmEffectiveGroupIds.length > 0 ? cmEffectiveGroupIds : auth.assigned_group_ids
      )
    : [];

  const searchEsc = filters.search.trim() ? escapeIlike(filters.search.trim()) : '';

  let filterStateId: number | null = filters.stateId;
  let filterParty = filters.party.trim();
  let filterGroupId: number | null = filters.groupId;

  if (!isAdmin(auth)) {
    if (isModerator(auth)) {
      filterGroupId = null;
    }
    if (isCampaignManager(auth)) {
      filterStateId = null;
      filterParty = '';
    }
  }

  const includePhone = isAdmin(auth);

  const { data, error } = await admin.rpc('admin_leaderboard_page', {
    p_mode: mode,
    p_moderator_state_ids: moderatorStates,
    p_cm_group_ids: cmGroups,
    p_date_from: filters.dateFrom.toISOString(),
    p_date_to: filters.dateTo.toISOString(),
    p_search: searchEsc,
    p_filter_state_id: filterStateId ?? null,
    p_filter_party: filterParty || null,
    p_filter_group_id: filterGroupId ?? null,
    p_include_phone: includePhone,
    p_offset: Math.min(Math.max(filters.offset, 0), ADMIN_LB_MAX_OFFSET),
    p_limit: clampLimit(String(filters.limit), API_DEFAULT_LIMIT, API_MAX_LIMIT),
  });

  if (error) return { error: error.message };
  return parseRpcBundle(data);
}

export async function fetchAllLeaderboardRowsForExport(
  admin: SupabaseClient,
  auth: VerifiedAdminAuth,
  filters: Omit<AdminLeaderboardFilters, 'offset' | 'limit'>,
  cmEffectiveGroupIds: string[] | null
): Promise<{ rows: AdminLeaderboardRow[]; truncated: boolean } | { error: string }> {
  const chunk = API_MAX_LIMIT;
  const out: AdminLeaderboardRow[] = [];
  let offset = 0;
  let truncated = false;
  for (;;) {
    const page = await fetchAdminLeaderboardPage(
      admin,
      auth,
      { ...filters, offset, limit: chunk },
      cmEffectiveGroupIds
    );
    if ('error' in page) return page;
    if (page.rows.length === 0) break;
    out.push(...page.rows);
    if (out.length >= ADMIN_LB_EXPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
    if (page.rows.length < chunk) break;
    offset += chunk;
    if (offset > ADMIN_LB_MAX_OFFSET) {
      truncated = true;
      break;
    }
  }
  return { rows: out.slice(0, ADMIN_LB_EXPORT_MAX_ROWS), truncated };
}

export type StateFilterOption = { state_id: number; state: string };

/**
 * Distinct state options for admin leaderboard filters (RBAC-scoped for moderators).
 */
export async function fetchStateFilterOptions(
  admin: SupabaseClient,
  auth: VerifiedAdminAuth
): Promise<StateFilterOption[]> {
  if (isCampaignManager(auth)) return [];
  let q = admin.from('profiles').select('state_id, state').not('state_id', 'is', null);
  if (isModerator(auth)) {
    const ids = auth.assigned_state_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return [];
    q = q.in('state_id', ids);
  }
  const { data, error } = await q.limit(3000);
  if (error || !Array.isArray(data)) return [];
  const map = new Map<number, string>();
  for (const row of data as { state_id?: unknown; state?: unknown }[]) {
    const sid = typeof row.state_id === 'number' ? row.state_id : Number(row.state_id);
    if (!Number.isFinite(sid)) continue;
    const label = String(row.state ?? '').trim() || `State ${sid}`;
    if (!map.has(sid)) map.set(sid, label);
  }
  return Array.from(map.entries())
    .map(([state_id, state]) => ({ state_id, state }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

export async function resolveCmGroupIdsForLeaderboard(
  admin: SupabaseClient,
  auth: VerifiedAdminAuth
): Promise<string[] | null> {
  if (!isCampaignManager(auth)) return null;
  const eff = await resolveEffectiveGroupIdsForCampaignManager(admin, auth.user.id, auth.assigned_group_ids);
  return eff;
}
