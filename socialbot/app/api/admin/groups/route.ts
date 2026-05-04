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

function aggregateTags(rows: { id: string; group_tags: unknown }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const t of toStrArr(row.group_tags)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Paginate through all profiles (PostgREST often caps ~1k rows per request). */
async function fetchAllProfileIdAndTags(admin: SupabaseClient): Promise<{ id: string; group_tags: unknown }[]> {
  const pageSize = 1000;
  const out: { id: string; group_tags: unknown }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, group_tags')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({ id: String(r.id ?? ''), group_tags: r.group_tags });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
}

async function fetchMembersForTag(admin: SupabaseClient, tag: string) {
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, name, phone, phone_number, avatar_url, group_tags')
      .overlaps('group_tags', [tag])
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
      const rows = await fetchMembersForTag(admin, tag);
      const members = rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        phone: String(r.phone ?? r.phone_number ?? ''),
        avatar_url: String(r.avatar_url ?? ''),
        group_tags: toStrArr(r.group_tags),
      }));

      return NextResponse.json({ tag, members }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const rows = await fetchAllProfileIdAndTags(admin);
    return NextResponse.json({ groups: aggregateTags(rows) }, { headers: { 'Cache-Control': 'no-store' } });
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
  if (!tag) return NextResponse.json({ error: 'Missing tag' }, { status: 400 });

  const { data: rows, error: fetchErr } = await admin.from('profiles').select('id, group_tags').overlaps('group_tags', [tag]);
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  let updated = 0;
  for (const row of rows ?? []) {
    const id = String((row as { id?: string }).id ?? '');
    if (!id) continue;
    const next = toStrArr((row as { group_tags?: unknown }).group_tags).filter((t) => t !== tag);
    const { error: upErr } = await admin.from('profiles').update({ group_tags: next }).eq('id', id);
    if (upErr) return NextResponse.json({ error: upErr.message, updated }, { status: 500 });
    updated += 1;
  }

  return NextResponse.json({ ok: true, tag, profilesUpdated: updated }, { headers: { 'Cache-Control': 'no-store' } });
}

type PatchBody = { userId?: string; add?: string[]; remove?: string[] };

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

  const { data: row, error: readErr } = await admin.from('profiles').select('group_tags').eq('id', userId).maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let tags = toStrArr((row as { group_tags?: unknown }).group_tags);
  const removeSet = new Set(remove.map((r) => r.toLowerCase()));
  tags = tags.filter((t) => !removeSet.has(t.toLowerCase()));
  for (const a of add) {
    if (!tags.some((t) => t.toLowerCase() === a.toLowerCase())) tags.push(a);
  }

  const { error: upErr } = await admin.from('profiles').update({ group_tags: tags }).eq('id', userId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, userId, group_tags: tags }, { headers: { 'Cache-Control': 'no-store' } });
}
