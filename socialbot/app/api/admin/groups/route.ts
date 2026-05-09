import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertAdminRole,
  createServiceRoleClient,
  isAdmin,
  isCampaignManager,
  isModerator,
  validateAdminSession,
} from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { buildScopedCountQuery, buildScopedQuery } from '@/lib/rbac/scoped-query-builder';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import {
  RbacError,
  requireCampaignManagerHasAssignedGroups,
  requireGroupAssignment,
  requireModeratorHasAssignedStates,
  requireOwnership,
  requireRole,
} from '@/lib/rbac/require';
import { SECURITY_LIMITS } from '@/lib/security-limits';

const NO_SERVICE_ROLE =
  'Group Management requires SUPABASE_SERVICE_ROLE_KEY on the server (Vercel env). Without it, only your own profile is visible under RLS, so group counts stay empty.';

function toStrArr(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) return p.map((x) => String(x ?? '').trim()).filter(Boolean);
      } catch {
        // fall through
      }
    }
    if (s.includes(',')) return s.split(',').map((x) => x.trim()).filter(Boolean);
    return [s];
  }
  return [];
}

/**
 * Counts tag strings across all profile rows.
 * Every row is visited: `null`, `[]`, or missing `group_tags` yields zero inner iterations (not skipped as a row).
 */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function aggregateGroupIds(rows: { id: string; group_id: unknown }[]): { tag: string; count: number }[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const gid = toNum(row.group_id);
    if (gid == null) continue;
    counts.set(gid, (counts.get(gid) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([gid, count]) => ({ tag: String(gid), count }))
    .sort((a, b) => Number(a.tag) - Number(b.tag));
}

type DbGroupRow = { id: number; name: string };

type DbGroupWithOwnerRow = { id: number; name: string; created_by: string | null };

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
}

function isMissingTableErr(err: { message?: string } | null | undefined, tableName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(tableName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found'));
}

function groupMembershipsMissingResponse() {
  return NextResponse.json(
    {
      error: "DB schema missing table public.group_memberships. Run Supabase migrations and refresh schema cache, then retry.",
      schemaMissing: true,
      missingTable: 'group_memberships',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

async function hasGroupMembershipsTable(admin: SupabaseClient): Promise<boolean> {
  // Best-effort check: query 0 rows. If table missing, PostgREST errors.
  const r = await admin.from('group_memberships').select('group_id', { count: 'exact', head: true }).limit(1);
  if ((r as any)?.error) {
    if (isMissingTableErr((r as any).error, 'group_memberships')) return false;
  }
  return true;
}

async function listMemberIdsForGroup(admin: SupabaseClient, groupId: number): Promise<string[]> {
  const pageSize = 1000;
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('group_memberships')
      .select('user_id')
      .eq('group_id', groupId)
      .order('user_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      if (isMissingTableErr(error as any, 'group_memberships')) throw new Error('__MISSING_GROUP_MEMBERSHIPS__');
      throw new Error(error.message);
    }
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    for (const r of rows) out.push(String(r.user_id ?? '').trim());
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out.filter(Boolean);
}

async function listLegacyProfileIdsForGroup(admin: SupabaseClient, groupId: number): Promise<string[]> {
  const pageSize = 1000;
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .eq('group_id', groupId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (id) out.push(id);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
}

async function fetchMembersForGroupIdViaMemberships(admin: SupabaseClient, groupId: number) {
  const memberIds = await listMemberIdsForGroup(admin, groupId);
  if (memberIds.length === 0) return [];
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const slice = memberIds.slice(from, from + pageSize);
    if (slice.length === 0) break;
    const { data, error } = await admin
      .from('profiles')
      .select('id, name, phone, avatar_url, group_id')
      .in('id', slice);
    if (error) throw new Error(error.message);
    out.push(...(((data ?? []) as any[]) satisfies any[]));
    if (slice.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
}

async function addMembersToGroup(admin: SupabaseClient, groupId: number, userIds: string[]) {
  const rows = userIds.map((u) => ({ group_id: groupId, user_id: u }));
  const { error } = await admin.from('group_memberships').upsert(rows, { onConflict: 'group_id,user_id' });
  if (error) {
    if (isMissingTableErr(error as any, 'group_memberships')) throw new Error('__MISSING_GROUP_MEMBERSHIPS__');
    throw new Error(error.message);
  }
}

async function removeMembersFromGroup(admin: SupabaseClient, groupId: number, userIds: string[]) {
  const { error } = await admin.from('group_memberships').delete().eq('group_id', groupId).in('user_id', userIds);
  if (error) {
    if (isMissingTableErr(error as any, 'group_memberships')) throw new Error('__MISSING_GROUP_MEMBERSHIPS__');
    throw new Error(error.message);
  }
}

async function selectGroupMaybeDeletedById(admin: SupabaseClient, id: number) {
  const res = await admin.from('groups').select('id, name, created_by, deleted_at').eq('id', id).maybeSingle();
  if (res.error && isMissingColumnErr(res.error, 'deleted_at')) {
    const res2 = await admin.from('groups').select('id, name, created_by').eq('id', id).maybeSingle();
    return { data: res2.data, error: res2.error, hasDeletedAt: false };
  }
  return { data: res.data, error: res.error, hasDeletedAt: true };
}

async function selectGroupMaybeDeletedByName(admin: SupabaseClient, name: string) {
  const res = await admin.from('groups').select('id, name, created_by, deleted_at').eq('name', name).maybeSingle();
  if (res.error && isMissingColumnErr(res.error, 'deleted_at')) {
    const res2 = await admin.from('groups').select('id, name, created_by').eq('name', name).maybeSingle();
    return { data: res2.data, error: res2.error, hasDeletedAt: false };
  }
  return { data: res.data, error: res.error, hasDeletedAt: true };
}

async function selectGroupsListMaybeDeleted(admin: SupabaseClient) {
  const res = await admin.from('groups').select('id, name, created_by, deleted_at').order('id', { ascending: true });
  if (res.error && isMissingColumnErr(res.error, 'deleted_at')) {
    const res2 = await admin.from('groups').select('id, name, created_by').order('id', { ascending: true });
    return { data: res2.data, error: res2.error, hasDeletedAt: false };
  }
  return { data: res.data, error: res.error, hasDeletedAt: true };
}

type ScopedViewer = {
  id: string;
  role: 'admin' | 'moderator' | 'campaign_manager';
  assigned_state_ids: number[];
  assigned_group_ids: string[];
};

function toScopedViewer(auth: {
  user: { id: string };
  role: 'admin' | 'moderator' | 'campaign_manager';
  assigned_state_ids: number[];
  assigned_group_ids: string[];
}): ScopedViewer {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

async function countScopedProfilesByIds(admin: SupabaseClient, viewer: ScopedViewer, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const batch = 500;
  let total = 0;
  for (let i = 0; i < userIds.length; i += batch) {
    const slice = userIds.slice(i, i + batch);
    let q: any = admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', slice);
    q = buildScopedCountQuery(viewer as any, q, 'profiles');
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    total += Number(count ?? 0);
  }
  return total;
}

async function countProfilesInGroup(admin: SupabaseClient, groupId: number): Promise<number> {
  const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('group_id', groupId);
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

async function countScopedProfilesInGroup(admin: SupabaseClient, viewer: ScopedViewer, groupId: number): Promise<number> {
  let q: any = admin.from('profiles').select('id', { count: 'exact', head: true }).eq('group_id', groupId);
  q = buildScopedCountQuery(viewer as any, q, 'profiles');
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

function requireModeratorOwnership(auth: { role: 'admin' | 'moderator'; user: { id: string } }, grp: DbGroupWithOwnerRow | null) {
  if (!grp) return;
  if (auth.role !== 'moderator') return;
  const owner = String(grp.created_by ?? '').trim();
  if (!owner || owner !== auth.user.id) {
    throw new Error('FORBIDDEN_NOT_OWNER');
  }
}

async function getGroupById(admin: SupabaseClient, id: number): Promise<DbGroupWithOwnerRow | null> {
  const { data, error, hasDeletedAt } = await selectGroupMaybeDeletedById(admin, id);
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (hasDeletedAt && (data as any).deleted_at != null) return null;
  return {
    id: Number((data as any).id),
    name: String((data as any).name ?? ''),
    created_by: (data as any).created_by != null ? String((data as any).created_by) : null,
  };
}

async function getGroupByName(admin: SupabaseClient, name: string): Promise<DbGroupWithOwnerRow | null> {
  const n = String(name ?? '').trim();
  if (!n) return null;
  const { data, error, hasDeletedAt } = await selectGroupMaybeDeletedByName(admin, n);
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (hasDeletedAt && (data as any).deleted_at != null) return null;
  return {
    id: Number((data as any).id),
    name: String((data as any).name ?? ''),
    created_by: (data as any).created_by != null ? String((data as any).created_by) : null,
  };
}

async function createGroup(admin: SupabaseClient, name: string, createdBy: string): Promise<DbGroupWithOwnerRow> {
  const n = String(name ?? '').trim();
  const { data, error } = await admin.from('groups').insert({ name: n, created_by: createdBy }).select('id, name, created_by').single();
  if (error) throw new Error(error.message);
  return {
    id: Number((data as any).id),
    name: String((data as any).name ?? ''),
    created_by: (data as any).created_by != null ? String((data as any).created_by) : null,
  };
}

async function resolveGroup(
  admin: SupabaseClient,
  tag: string,
  opts?: { createIfMissing?: boolean; createdBy?: string }
): Promise<DbGroupWithOwnerRow | null> {
  const raw = String(tag ?? '').trim();
  if (!raw) return null;

  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    return await getGroupById(admin, asNum);
  }

  const existing = await getGroupByName(admin, raw);
  if (existing) return existing;
  if (opts?.createIfMissing) {
    const createdBy = String(opts.createdBy ?? '').trim();
    if (!createdBy) throw new Error('Missing createdBy for group creation');
    return await createGroup(admin, raw, createdBy);
  }
  return null;
}

async function fetchMembersForGroupId(admin: SupabaseClient, groupId: number) {
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, name, phone, avatar_url, group_id')
      .eq('group_id', groupId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
}

async function allocateNextGroupId(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('profiles')
    .select('group_id')
    .not('group_id', 'is', null)
    .order('group_id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const maxId = toNum((data as any)?.group_id) ?? 0;
  return maxId + 1;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
    requireCampaignManagerHasAssignedGroups(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }
  const adminRole = isAdmin(auth);
  if (adminRole) assertAdminRole(auth);

  const tag = (request.nextUrl.searchParams.get('tag') ?? '').trim();

  try {
    const hasMemberships = await hasGroupMembershipsTable(admin);
    if (tag) {
      const grp = await resolveGroup(admin, tag);
      if (!grp) return NextResponse.json({ error: 'Invalid group id/name' }, { status: 400 });
      try {
        const ok = canAccessResource(
          {
            id: auth.user.id,
            role: auth.role,
            assigned_state_ids: auth.assigned_state_ids,
            assigned_group_ids: auth.assigned_group_ids,
          },
          { created_by: grp.created_by, group_id: String(grp.id) },
          {
            resourceType: 'groups',
            audit: {
              resourceType: 'groups',
              action: 'groups.read',
              resourceId: String(grp.id),
              resourceName: grp.name,
            },
          }
        );
        if (!ok) throw new RbacError('Forbidden', 403);
      } catch (e) {
        if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const scopedUser = {
        id: auth.user.id,
        role: auth.role,
        assigned_state_ids: auth.assigned_state_ids,
        assigned_group_ids: auth.assigned_group_ids,
      } as any;

      // Build a profiles query scoped in SQL (no fetch-then-filter).
      let profQ: any = admin.from('profiles').select('id, name, phone, avatar_url, group_id');

      if (hasMemberships) {
        // In many-to-many mode, membership is authoritative. Fetch member IDs for this group,
        // then query profiles with RBAC scoping applied.
        const memberIds = await listMemberIdsForGroup(admin, grp.id);
        if (memberIds.length === 0) {
          return NextResponse.json({ tag: String(grp.id), name: grp.name, members: [] }, { headers: { 'Cache-Control': 'no-store' } });
        }
        profQ = profQ.in('id', memberIds);
      } else {
        // Legacy single-group mode.
        profQ = profQ.eq('group_id', grp.id);
      }

      // Apply RBAC scoping (moderator state scope, campaign_manager group/membership scope).
      if (!adminRole) {
        profQ = buildScopedQuery(scopedUser, profQ, 'profiles');
      }
      const { data: profRows, error: profErr } = await profQ;
      if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

      const redactPhone = isModerator(auth) || isCampaignManager(auth);
      const members = ((profRows ?? []) as any[]).map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        phone: redactPhone ? '' : String(r.phone ?? ''),
        avatar_url: String(r.avatar_url ?? ''),
        group_id: toNum((r as any).group_id),
      }));

      return NextResponse.json({ tag: String(grp.id), name: grp.name, members }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Prefer authoritative group list from `groups` table; if deleted_at is missing in DB, fall back gracefully.
    // Build a scoped query instead of fetching all groups then filtering in JS.
    let q = admin.from('groups').select('id, name, created_by, deleted_at').order('id', { ascending: true }) as any;
    if (!adminRole) {
      q = buildScopedQuery(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        q,
        'groups'
      );
    }
    const res = await q;
    let groupRowsAll = ((res as any).data ?? []) as any[];
    let baseErr = (res as any).error ?? null;
    let hasDeletedAt = true;
    if (baseErr && isMissingColumnErr(baseErr, 'deleted_at')) {
      hasDeletedAt = false;
      let q2 = admin.from('groups').select('id, name, created_by').order('id', { ascending: true }) as any;
      if (!adminRole) {
        q2 = buildScopedQuery(
          { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
          q2,
          'groups'
        );
      }
      const res2 = await q2;
      groupRowsAll = ((res2 as any).data ?? []) as any[];
      baseErr = (res2 as any).error ?? null;
    }
    if (baseErr) throw new Error(baseErr.message);
    const groupRows = groupRowsAll.filter((g) => (hasDeletedAt ? (g as any).deleted_at == null : true));

    const visibleGroupIds = groupRows.map((g) => Number(g.id)).filter((n) => Number.isFinite(n));
    const counts = new Map<number, number>();

    if (visibleGroupIds.length > 0) {
      if (hasMemberships) {
        // Count members by group_id for ONLY visible groups (no global scans).
        const pageSize = 1000;
        let from = 0;
        for (;;) {
          const { data: memRows, error: memErr } = await admin
            .from('group_memberships')
            .select('group_id')
            .in('group_id', visibleGroupIds)
            .order('group_id', { ascending: true })
            .range(from, from + pageSize - 1);
          if (memErr) {
            if (isMissingTableErr(memErr as any, 'group_memberships')) throw new Error('__MISSING_GROUP_MEMBERSHIPS__');
            throw new Error(memErr.message);
          }
          const rows = (memRows ?? []) as any[];
          if (rows.length === 0) break;
          for (const r of rows) {
            const gid = toNum(r.group_id);
            if (gid == null) continue;
            counts.set(gid, (counts.get(gid) ?? 0) + 1);
          }
          if (rows.length < pageSize) break;
          from += pageSize;
          if (from > 2000000) break;
        }
      } else {
        // Legacy fallback: count via scoped profiles (still DB-scoped before fetch).
        const scopedUser = {
          id: auth.user.id,
          role: auth.role,
          assigned_state_ids: auth.assigned_state_ids,
          assigned_group_ids: auth.assigned_group_ids,
        } as any;
        const pageSize = 1000;
        let from = 0;
        for (;;) {
          let pq: any = admin
            .from('profiles')
            .select('group_id')
            .in('group_id', visibleGroupIds)
            .order('id', { ascending: true })
            .range(from, from + pageSize - 1);
          if (!adminRole) {
            pq = buildScopedQuery(scopedUser, pq, 'profiles');
          }
          const { data: pRows, error: pErr } = await pq;
          if (pErr) throw new Error(pErr.message);
          const rows = (pRows ?? []) as any[];
          if (rows.length === 0) break;
          for (const r of rows) {
            const gid = toNum((r as any).group_id);
            if (gid == null) continue;
            counts.set(gid, (counts.get(gid) ?? 0) + 1);
          }
          if (rows.length < pageSize) break;
          from += pageSize;
          if (from > 500000) break;
        }
      }
    }

    const groups = ((groupRows ?? []) as any[]).map((g) => ({
      tag: String(g.id ?? ''),
      name: String(g.name ?? ''),
      count: counts.get(Number(g.id ?? 0)) ?? 0,
    }));

    return NextResponse.json({ groups }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Error && e.message === '__MISSING_GROUP_MEMBERSHIPS__') return groupMembershipsMissingResponse();
    const msg = e instanceof Error ? e.message : 'Failed to load groups';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (isCampaignManager(auth)) {
    return NextResponse.json({ error: 'Campaign managers cannot modify groups' }, { status: 403 });
  }
  try {
    requireRole(auth, ['admin', 'moderator']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 503 });
  }

  const tag = (request.nextUrl.searchParams.get('tag') ?? '').trim();
  if (!tag) return NextResponse.json({ error: 'Missing group id/name' }, { status: 400 });
  const grp = await resolveGroup(admin, tag);
  if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });

  {
    const decision = canPerformMutation(
      { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
      'groups.delete',
      { created_by: grp.created_by, group_id: String(grp.id) },
      null,
      { resourceType: 'groups', resourceId: String(grp.id), resourceName: grp.name }
    );
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  const hasMemberships = await hasGroupMembershipsTable(admin);
  const scopedViewer = toScopedViewer(auth as any);
  let memberIds: string[] = [];
  if (hasMemberships) {
    try {
      memberIds = await listMemberIdsForGroup(admin, grp.id);
    } catch (e) {
      if (e instanceof Error && e.message === '__MISSING_GROUP_MEMBERSHIPS__') return groupMembershipsMissingResponse();
      throw e;
    }
  }
  // canAccessResource intentionally NOT used here for moderators because delete has extra safeguards (state isolation) below.

  // For moderators, ensure the group doesn't contain out-of-scope members before deleting the group row.
  if (isModerator(auth)) {
    try {
      requireOwnership(grp.created_by, auth.user.id);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    let totalMembers = 0;
    let scopedMembers = 0;
    if (hasMemberships) {
      totalMembers = memberIds.length;
      scopedMembers = await countScopedProfilesByIds(admin, scopedViewer, memberIds);
    } else {
      totalMembers = await countProfilesInGroup(admin, grp.id);
      scopedMembers = await countScopedProfilesInGroup(admin, scopedViewer, grp.id);
    }
    if (scopedMembers !== totalMembers) {
      return NextResponse.json({ error: 'Forbidden: group contains users outside assigned_state_ids' }, { status: 403 });
    }
  }
  if (hasMemberships) {
    // Removing the group: membership rows will be deleted by FK CASCADE on group delete,
    // but remove them explicitly so we can return accurate affected_users_count even if delete fails.
    try {
      await removeMembersFromGroup(admin, grp.id, memberIds);
    } catch (e) {
      if (e instanceof Error && e.message === '__MISSING_GROUP_MEMBERSHIPS__') return groupMembershipsMissingResponse();
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to remove members' }, { status: 500 });
    }
  } else {
    try {
      memberIds = await listLegacyProfileIdsForGroup(admin, grp.id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load group members' }, { status: 500 });
    }

    const { error: upErr } = await admin.from('profiles').update({ group_id: null }).eq('group_id', grp.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data: before, error: beforeErr } = await admin.from('groups').select('*').eq('id', grp.id).maybeSingle();
  if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 });

  // Soft delete group row (core entity) instead of hard delete.
  const delPatch = { deleted_at: new Date().toISOString(), deleted_by: auth.user.id };
  const { data: after, error: delErr } = await admin.from('groups').update(delPatch).eq('id', grp.id).select('*').single();
  if (delErr) {
    // Backward-compatible: older DB may not have deleted_at/deleted_by columns yet.
    if (isMissingColumnErr(delErr as any, 'deleted_at') || isMissingColumnErr(delErr as any, 'deleted_by')) {
      const hard = await admin.from('groups').delete().eq('id', grp.id);
      if ((hard as any).error) {
        return NextResponse.json({ error: (hard as any).error?.message ?? 'Delete failed' }, { status: 500 });
      }
      void logAdminAction({
        actor_user_id: auth.user.id,
        actor_role: auth.role,
        action_type: 'groups.delete',
        resource_type: 'groups',
        resource_id: String(grp.id),
        resource_name: grp.name,
        previous_data: before,
        new_data: null,
        metadata: { member_ids: memberIds, mode: 'hard_delete_fallback' },
        affected_users_count: memberIds.length,
        severity: 'warning',
        undoable: false,
        scope_group_ids: [String(grp.id)],
        scope_user_ids: memberIds,
      });
      return NextResponse.json({ ok: true, group_id: grp.id, mode: 'hard_delete_fallback' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  void logAdminAction({
    actor_user_id: auth.user.id,
    actor_role: auth.role,
    action_type: 'groups.delete',
    resource_type: 'groups',
    resource_id: String(grp.id),
    resource_name: grp.name,
    previous_data: before,
    new_data: after,
    metadata: { member_ids: memberIds },
    affected_users_count: memberIds.length,
    severity: 'warning',
    undoable: true,
    scope_group_ids: [String(grp.id)],
    scope_user_ids: memberIds,
  });

  return NextResponse.json({ ok: true, group_id: grp.id }, { headers: { 'Cache-Control': 'no-store' } });
}

type PatchBody = { userId?: string; add?: string[]; remove?: string[] };

type CreateBody = { tag?: string; userIds?: string[] };

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (isCampaignManager(auth)) {
    return NextResponse.json({ error: 'Campaign managers cannot modify groups' }, { status: 403 });
  }
  try {
    requireRole(auth, ['admin', 'moderator']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }

  let body: CreateBody = {};
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tag = String(body.tag ?? '').trim();
  const userIds = Array.isArray(body.userIds) ? body.userIds.map((x) => String(x).trim()).filter(Boolean) : [];

  if (!tag) return NextResponse.json({ error: 'Missing group name/id' }, { status: 400 });
  if (userIds.length === 0) return NextResponse.json({ error: 'Select at least one user' }, { status: 400 });
  if (userIds.length > SECURITY_LIMITS.groupAddMembers) {
    return NextResponse.json({ error: `Too many users. Max ${SECURITY_LIMITS.groupAddMembers}` }, { status: 400 });
  }

  // Foreign key constraint requires that `profiles.group_id` exists in `groups` table.
  // If tag is numeric, it must already exist. If tag is a name, create group row if missing.
  const grp = await resolveGroup(admin, tag, { createIfMissing: true, createdBy: auth.user.id });
  if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });
  const hasMemberships = await hasGroupMembershipsTable(admin);

  {
    const decision = canPerformMutation(
      { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
      'groups.members.add',
      { created_by: grp.created_by, group_id: String(grp.id) },
      { userIds, tag: String(grp.id) } as any,
      { resourceType: 'groups', resourceId: String(grp.id), resourceName: grp.name }
    );
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  if (isModerator(auth)) {
    // Ownership-based access control: moderators can only use groups created by themselves.
    try {
      requireOwnership(grp.created_by, auth.user.id);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  if (isModerator(auth)) {
    /**
     * Fail-closed DB-scoped guard:
     * do not fetch candidates and filter in JS. Count scoped IDs in SQL and require
     * every requested profile id to be in moderator scope.
     */
    const scopedCount = await countScopedProfilesByIds(admin, toScopedViewer(auth as any), userIds);
    if (scopedCount !== userIds.length) {
      return NextResponse.json({ error: 'Forbidden: includes users outside assigned state' }, { status: 403 });
    }
  }

  if (hasMemberships) {
    try {
      await addMembersToGroup(admin, grp.id, userIds);
    } catch (e) {
      if (e instanceof Error && e.message === '__MISSING_GROUP_MEMBERSHIPS__') return groupMembershipsMissingResponse();
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to add members' }, { status: 500 });
    }
  } else {
    const { error: upErr } = await admin.from('profiles').update({ group_id: grp.id }).in('id', userIds);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, group_id: grp.id, name: grp.name, requested: userIds.length, updated: userIds.length },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (isCampaignManager(auth)) {
    return NextResponse.json({ error: 'Campaign managers cannot modify groups' }, { status: 403 });
  }
  try {
    requireRole(auth, ['admin', 'moderator']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }
  const hasMemberships = await hasGroupMembershipsTable(admin);

  let body: PatchBody = {};
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userId = String(body.userId ?? '').trim();
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const add = Array.isArray(body.add) ? body.add.map((x) => String(x).trim()).filter(Boolean) : [];
  const remove = Array.isArray(body.remove) ? body.remove.map((x) => String(x).trim()).filter(Boolean) : [];
  if (add.length === 0 && remove.length === 0) {
    return NextResponse.json({ error: 'Provide add and/or remove' }, { status: 400 });
  }
  if (add.length > SECURITY_LIMITS.groupPatchOps || remove.length > SECURITY_LIMITS.groupPatchOps) {
    return NextResponse.json({ error: `Too many group operations. Max ${SECURITY_LIMITS.groupPatchOps} per add/remove` }, { status: 400 });
  }

  const { data: row, error: readErr } = await admin
    .from('profiles')
    .select('group_id')
    .eq('id', userId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const current = toNum((row as any).group_id);
  let next: number | null = current;

  if (add.length > 0) {
    const gid = Number(add[0]);
    if (!Number.isFinite(gid)) return NextResponse.json({ error: 'Invalid group id in add[]' }, { status: 400 });
    const grp = await getGroupById(admin, gid);
    if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });

    {
      const decision = canPerformMutation(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        'groups.members.add',
        { created_by: grp.created_by, group_id: String(grp.id) },
        { userId, add: [String(gid)] } as any,
        { resourceType: 'groups', resourceId: String(gid), resourceName: grp.name }
      );
      if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
    }
    if (isModerator(auth)) {
      try {
        requireOwnership(grp.created_by, auth.user.id);
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    if (isModerator(auth)) {
      const scopedCount = await countScopedProfilesByIds(admin, toScopedViewer(auth as any), [userId]);
      if (scopedCount !== 1) {
        return NextResponse.json({ error: 'Forbidden: user outside assigned_state_ids' }, { status: 403 });
      }
    }
    if (hasMemberships) {
      try {
        await addMembersToGroup(admin, gid, [userId]);
      } catch (e) {
        if (e instanceof Error && e.message === '__MISSING_GROUP_MEMBERSHIPS__') return groupMembershipsMissingResponse();
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Add failed' }, { status: 500 });
      }
      // Do not modify profiles.group_id in many-to-many mode.
      next = current;
    } else {
      next = gid;
    }
  } else if (remove.length > 0 && current != null) {
    if (isModerator(auth)) {
      const grp = await getGroupById(admin, current);
      if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });
      try {
        requireOwnership(grp.created_by, auth.user.id);
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    if (isModerator(auth)) {
      const scopedCount = await countScopedProfilesByIds(admin, toScopedViewer(auth as any), [userId]);
      if (scopedCount !== 1) {
        return NextResponse.json({ error: 'Forbidden: user outside assigned_state_ids' }, { status: 403 });
      }
    }
    const removeSet = new Set(remove.map((x) => String(Number(x))));
    if (hasMemberships) {
      const idsToRemove = remove.map((x) => String(Number(x))).filter(Boolean);
      const gids = idsToRemove.map((x) => Number(x)).filter((n) => Number.isFinite(n));
      for (const gid of gids) {
        const grp = await getGroupById(admin, gid);
        if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });
        const decision = canPerformMutation(
          { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
          'groups.members.remove',
          { created_by: grp.created_by, group_id: String(grp.id) },
          { userId, remove: [String(gid)] } as any,
          { resourceType: 'groups', resourceId: String(gid), resourceName: grp.name }
        );
        if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
      }
      try {
        for (const gid of gids) await removeMembersFromGroup(admin, gid, [userId]);
      } catch (e) {
        if (e instanceof Error && e.message === '__MISSING_GROUP_MEMBERSHIPS__') return groupMembershipsMissingResponse();
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Remove failed' }, { status: 500 });
      }
      next = current;
    } else {
      if (removeSet.has(String(current))) next = null;
    }
  }

  if (!hasMemberships) {
    const { error: upErr } = await admin.from('profiles').update({ group_id: next }).eq('id', userId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId, group_id: next }, { headers: { 'Cache-Control': 'no-store' } });
}
