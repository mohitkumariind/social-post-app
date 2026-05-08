import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { RbacError, requireModeratorHasAssignedStates, requireOwnership, requireRole } from '@/lib/rbac/require';

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

function overlapsAssignedStates(profileAssigned: unknown, viewerAssigned: number[]): boolean {
  const idsArr = Array.isArray(profileAssigned) ? profileAssigned : [];
  const viewer = viewerAssigned.map(Number);
  return idsArr.some((x: any) => viewer.includes(Number(x)));
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
  const { data, error } = await admin.from('groups').select('id, name, created_by, deleted_at').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: Number((data as any).id),
    name: String((data as any).name ?? ''),
    created_by: (data as any).created_by != null ? String((data as any).created_by) : null,
  };
}

async function getGroupByName(admin: SupabaseClient, name: string): Promise<DbGroupWithOwnerRow | null> {
  const n = String(name ?? '').trim();
  if (!n) return null;
  const { data, error } = await admin.from('groups').select('id, name, created_by, deleted_at').eq('name', n).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
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

/** Paginate through all profiles (PostgREST often caps ~1k rows per request). */
async function fetchAllProfileIdAndGroupId(admin: SupabaseClient): Promise<{ id: string; group_id: unknown }[]> {
  const pageSize = 1000;
  const out: { id: string; group_id: unknown }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, group_id')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({ id: String(r.id ?? ''), group_id: (r as any).group_id });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
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
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }

  const tag = (request.nextUrl.searchParams.get('tag') ?? '').trim();

  try {
    if (tag) {
      const grp = await resolveGroup(admin, tag);
      if (!grp) return NextResponse.json({ error: 'Invalid group id/name' }, { status: 400 });
      if (auth.role === 'moderator' || auth.role === 'campaign_manager') {
        try {
          requireOwnership(grp.created_by, auth.user.id);
        } catch {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      const rows = await fetchMembersForGroupId(admin, grp.id);
      const membersAll = rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        phone: String(r.phone ?? ''),
        avatar_url: String(r.avatar_url ?? ''),
        group_id: toNum((r as any).group_id),
      }));
      const members =
        auth.role === 'moderator'
          ? membersAll.filter((m) => {
              // Only include members in the assigned state, and do not return phone (personal info).
              return true;
            }).map((m) => ({ ...m, phone: '' }))
          : membersAll;

      if (auth.role === 'moderator') {
        const memberIds = membersAll.map((m) => m.id).filter(Boolean);
        if (memberIds.length > 0) {
          const { data: stRows, error: stErr } = await admin
            .from('profiles')
            .select('id, assigned_state_ids')
            .in('id', memberIds);
          if (stErr) throw new Error(stErr.message);
          const viewerStates = auth.assigned_state_ids.map(Number);
          const allowed = new Set(
            (stRows ?? [])
              .filter((r: any) => {
                const ids = Array.isArray(r.assigned_state_ids) ? r.assigned_state_ids : [];
                return ids.some((x: any) => viewerStates.includes(Number(x)));
              })
              .map((r: any) => String(r.id))
          );
          const filtered = membersAll.filter((m) => allowed.has(m.id)).map((m) => ({ ...m, phone: '' }));
          return NextResponse.json({ tag: String(grp.id), name: grp.name, members: filtered }, { headers: { 'Cache-Control': 'no-store' } });
        }
        return NextResponse.json({ tag: String(grp.id), name: grp.name, members: [] }, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (auth.role === 'campaign_manager') {
        // Limited visibility, similar to moderators.
        const filtered = membersAll.map((m) => ({ ...m, phone: '' }));
        return NextResponse.json({ tag: String(grp.id), name: grp.name, members: filtered }, { headers: { 'Cache-Control': 'no-store' } });
      }

      return NextResponse.json({ tag: String(grp.id), name: grp.name, members }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Prefer authoritative group list from `groups` table; join with counts from profiles.
    const groupQuery = admin.from('groups').select('id, name, created_by').is('deleted_at', null).order('id', { ascending: true });
    const { data: groupRows, error: gErr } =
      auth.role === 'moderator' || auth.role === 'campaign_manager'
        ? await groupQuery.eq('created_by', auth.user.id)
        : await groupQuery;
    if (gErr) throw new Error(gErr.message);

    const countsRowsAll = await fetchAllProfileIdAndGroupId(admin);
    const countsRows =
      auth.role === 'moderator'
        ? await (async () => {
            const ids = countsRowsAll.map((r) => r.id).filter(Boolean);
            if (ids.length === 0) return [];
            const { data: stRows, error: stErr } = await admin
              .from('profiles')
              .select('id, assigned_state_ids, group_id')
              .in('id', ids);
            if (stErr) throw new Error(stErr.message);
            const viewerStates = auth.assigned_state_ids.map(Number);
            return (stRows ?? [])
              .filter((r: any) => {
                const idsArr = Array.isArray(r.assigned_state_ids) ? r.assigned_state_ids : [];
                return idsArr.some((x: any) => viewerStates.includes(Number(x)));
              })
              .map((r: any) => ({ id: String(r.id ?? ''), group_id: (r as any).group_id }))
              .filter((r) => r.id);
          })()
        : countsRowsAll;
    const counts = new Map<string, number>();
    for (const g of aggregateGroupIds(countsRows)) counts.set(g.tag, g.count);

    const groups = ((groupRows ?? []) as any[]).map((g) => ({
      tag: String(g.id ?? ''),
      name: String(g.name ?? ''),
      count: counts.get(String(g.id ?? '')) ?? 0,
    }));

    return NextResponse.json({ groups }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
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
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
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
  if (auth.role === 'moderator' || auth.role === 'campaign_manager') {
    try {
      requireOwnership(grp.created_by, auth.user.id);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // For moderators, ensure the group doesn't contain out-of-scope members before deleting the group row.
  if (auth.role === 'moderator') {
    const viewerStates = auth.assigned_state_ids.map(Number);
    const { data: memberRows, error: memErr } = await admin
      .from('profiles')
      .select('id, assigned_state_ids')
      .eq('group_id', grp.id);
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    const outOfScope = (memberRows ?? []).some((r: any) => !overlapsAssignedStates(r.assigned_state_ids, viewerStates));
    if (outOfScope) {
      return NextResponse.json({ error: 'Forbidden: group contains users outside assigned_state_ids' }, { status: 403 });
    }
  }

  const { data: members, error: memErr } = await admin.from('profiles').select('id').eq('group_id', grp.id);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
  const memberIds = (members ?? []).map((m: any) => String(m.id ?? '')).filter(Boolean);

  const { error: upErr } = await admin.from('profiles').update({ group_id: null }).eq('group_id', grp.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: before, error: beforeErr } = await admin.from('groups').select('*').eq('id', grp.id).maybeSingle();
  if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 });

  // Soft delete group row (core entity) instead of hard delete.
  const delPatch = { deleted_at: new Date().toISOString(), deleted_by: auth.user.id };
  const { data: after, error: delErr } = await admin.from('groups').update(delPatch).eq('id', grp.id).select('*').single();
  if (delErr) {
    return NextResponse.json({ ok: true, group_id: grp.id, warning: delErr.message }, { headers: { 'Cache-Control': 'no-store' } });
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
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
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

  // Foreign key constraint requires that `profiles.group_id` exists in `groups` table.
  // If tag is numeric, it must already exist. If tag is a name, create group row if missing.
  const grp = await resolveGroup(admin, tag, { createIfMissing: true, createdBy: auth.user.id });
  if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });

  if (auth.role === 'moderator' || auth.role === 'campaign_manager') {
    // Ownership-based access control: moderators can only use groups created by themselves.
    try {
      requireOwnership(grp.created_by, auth.user.id);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  if (auth.role === 'moderator') {
    const { data: rows, error: stErr } = await admin
      .from('profiles')
      .select('id, assigned_state_ids')
      .in('id', userIds);
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
    const viewerStates = auth.assigned_state_ids.map(Number);
    const allowed = (rows ?? [])
      .filter((r: any) => {
        return overlapsAssignedStates(r.assigned_state_ids, viewerStates);
      })
      .map((r: any) => String(r.id))
      .filter(Boolean);
    if (allowed.length !== userIds.length) {
      return NextResponse.json({ error: 'Forbidden: includes users outside assigned state' }, { status: 403 });
    }
  }

  const { error: upErr } = await admin.from('profiles').update({ group_id: grp.id }).in('id', userIds);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

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
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }

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

  const { data: row, error: readErr } = await admin
    .from('profiles')
    .select('group_id, assigned_state_ids')
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
    if (auth.role === 'moderator' || auth.role === 'campaign_manager') {
      try {
        requireOwnership(grp.created_by, auth.user.id);
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    if (auth.role === 'moderator') {
      if (!overlapsAssignedStates((row as any).assigned_state_ids, auth.assigned_state_ids)) {
        return NextResponse.json({ error: 'Forbidden: user outside assigned_state_ids' }, { status: 403 });
      }
    }
    next = gid;
  } else if (remove.length > 0 && current != null) {
    if (auth.role === 'moderator' || auth.role === 'campaign_manager') {
      const grp = await getGroupById(admin, current);
      if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });
      try {
        requireOwnership(grp.created_by, auth.user.id);
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    if (auth.role === 'moderator') {
      if (!overlapsAssignedStates((row as any).assigned_state_ids, auth.assigned_state_ids)) {
        return NextResponse.json({ error: 'Forbidden: user outside assigned_state_ids' }, { status: 403 });
      }
    }
    const removeSet = new Set(remove.map((x) => String(Number(x))));
    if (removeSet.has(String(current))) next = null;
  }

  const { error: upErr } = await admin.from('profiles').update({ group_id: next }).eq('id', userId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, userId, group_id: next }, { headers: { 'Cache-Control': 'no-store' } });
}
