import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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

async function getGroupById(admin: SupabaseClient, id: number): Promise<DbGroupRow | null> {
  const { data, error } = await admin.from('groups').select('id, name').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: Number((data as any).id), name: String((data as any).name ?? '') };
}

async function getGroupByName(admin: SupabaseClient, name: string): Promise<DbGroupRow | null> {
  const n = String(name ?? '').trim();
  if (!n) return null;
  const { data, error } = await admin.from('groups').select('id, name').eq('name', n).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: Number((data as any).id), name: String((data as any).name ?? '') };
}

async function createGroup(admin: SupabaseClient, name: string): Promise<DbGroupRow> {
  const n = String(name ?? '').trim();
  const { data, error } = await admin.from('groups').insert({ name: n }).select('id, name').single();
  if (error) throw new Error(error.message);
  return { id: Number((data as any).id), name: String((data as any).name ?? '') };
}

async function resolveGroup(admin: SupabaseClient, tag: string, opts?: { createIfMissing?: boolean }): Promise<DbGroupRow | null> {
  const raw = String(tag ?? '').trim();
  if (!raw) return null;

  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    return await getGroupById(admin, asNum);
  }

  const existing = await getGroupByName(admin, raw);
  if (existing) return existing;
  if (opts?.createIfMissing) return await createGroup(admin, raw);
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

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: NO_SERVICE_ROLE }, { status: 503 });
  }

  const tag = (request.nextUrl.searchParams.get('tag') ?? '').trim();

  try {
    if (tag) {
      const grp = await resolveGroup(admin, tag);
      if (!grp) return NextResponse.json({ error: 'Invalid group id/name' }, { status: 400 });
      const rows = await fetchMembersForGroupId(admin, grp.id);
      const members = rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        phone: String(r.phone ?? ''),
        avatar_url: String(r.avatar_url ?? ''),
        group_id: toNum((r as any).group_id),
      }));

      return NextResponse.json({ tag: String(grp.id), name: grp.name, members }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Prefer authoritative group list from `groups` table; join with counts from profiles.
    const { data: groupRows, error: gErr } = await admin.from('groups').select('id, name').order('id', { ascending: true });
    if (gErr) throw new Error(gErr.message);

    const countsRows = await fetchAllProfileIdAndGroupId(admin);
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

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 503 });
  }

  const tag = (request.nextUrl.searchParams.get('tag') ?? '').trim();
  if (!tag) return NextResponse.json({ error: 'Missing group id/name' }, { status: 400 });
  const grp = await resolveGroup(admin, tag);
  if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });

  const { error: upErr } = await admin.from('profiles').update({ group_id: null }).eq('group_id', grp.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Best-effort: remove group row itself.
  const { error: delErr } = await admin.from('groups').delete().eq('id', grp.id);
  if (delErr) {
    return NextResponse.json({ ok: true, group_id: grp.id, warning: delErr.message }, { headers: { 'Cache-Control': 'no-store' } });
  }

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
  const grp = await resolveGroup(admin, tag, { createIfMissing: true });
  if (!grp) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });

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

  const { data: row, error: readErr } = await admin.from('profiles').select('group_id').eq('id', userId).maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const current = toNum((row as any).group_id);
  let next: number | null = current;

  if (add.length > 0) {
    const gid = Number(add[0]);
    if (!Number.isFinite(gid)) return NextResponse.json({ error: 'Invalid group id in add[]' }, { status: 400 });
    next = gid;
  } else if (remove.length > 0 && current != null) {
    const removeSet = new Set(remove.map((x) => String(Number(x))));
    if (removeSet.has(String(current))) next = null;
  }

  const { error: upErr } = await admin.from('profiles').update({ group_id: next }).eq('id', userId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, userId, group_id: next }, { headers: { 'Cache-Control': 'no-store' } });
}
