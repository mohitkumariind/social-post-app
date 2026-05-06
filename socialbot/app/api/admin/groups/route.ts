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
  const groupId = tag ? Number(tag) : NaN;

  try {
    if (tag) {
      if (!Number.isFinite(groupId)) return NextResponse.json({ error: 'Invalid group id' }, { status: 400 });
      const rows = await fetchMembersForGroupId(admin, groupId);
      const members = rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        phone: String(r.phone ?? ''),
        avatar_url: String(r.avatar_url ?? ''),
        group_id: toNum((r as any).group_id),
      }));

      return NextResponse.json({ tag, members }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const rows = await fetchAllProfileIdAndGroupId(admin);
    const groups = aggregateGroupIds(rows);
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
  const groupId = tag ? Number(tag) : NaN;
  if (!tag || !Number.isFinite(groupId)) return NextResponse.json({ error: 'Missing/invalid group id' }, { status: 400 });

  const { error: upErr } = await admin.from('profiles').update({ group_id: null }).eq('group_id', groupId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, group_id: groupId }, { headers: { 'Cache-Control': 'no-store' } });
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
  const parsed = tag ? Number(tag) : NaN;
  const userIds = Array.isArray(body.userIds) ? body.userIds.map((x) => String(x).trim()).filter(Boolean) : [];

  if (!tag) return NextResponse.json({ error: 'Missing group name/id' }, { status: 400 });
  if (userIds.length === 0) return NextResponse.json({ error: 'Select at least one user' }, { status: 400 });

  // Allow "group name" input in UI. If it's not numeric, allocate next numeric group_id.
  const groupId = Number.isFinite(parsed) ? parsed : await allocateNextGroupId(admin);

  const { error: upErr } = await admin.from('profiles').update({ group_id: groupId }).in('id', userIds);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json(
    { ok: true, group_id: groupId, requested: userIds.length, updated: userIds.length },
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
