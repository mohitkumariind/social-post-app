import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function toNumArray(v: unknown): number[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

function hasAssignedState(stateIds: number[], assigned: number): boolean {
  return stateIds.includes(assigned);
}

function isSubset(sub: number[], sup: number[]): boolean {
  const set = new Set(sup.map((n) => Number(n)));
  return sub.every((n) => set.has(Number(n)));
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return json({ error: 'Moderator is missing assigned_state_ids' }, 403);
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim();
  const name = (request.nextUrl.searchParams.get('name') ?? '').trim();

  // Detail fetch (used by admin UI for secure reads).
  if (id || name) {
    let q = db.from('events').select('*').limit(1) as any;
    q = id ? q.eq('id', id) : q.eq('name', name);
    const { data, error } = await q.maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: 'Not found' }, 404);

    if (auth.role === 'moderator') {
      const owner = String((data as any).created_by ?? '').trim();
      if (!owner || owner !== auth.user.id) return json({ error: 'Forbidden' }, 403);
      const stateIds = toNumArray((data as any).state_id);
      if (stateIds.length === 0 || !isSubset(stateIds, auth.assigned_state_ids)) return json({ error: 'Forbidden' }, 403);
    }

    return json({ event: data, usedServiceRole: !!admin });
  }

  // Listing
  let q = db.from('events').select('*').order('created_at', { ascending: false }) as any;
  if (auth.role === 'moderator') {
    // Must satisfy BOTH: ownership and assigned states.
    q = q.eq('created_by', auth.user.id).overlaps('state_id', auth.assigned_state_ids);
  }
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ events: data ?? [], usedServiceRole: !!admin });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return json({ error: 'Moderator is missing assigned_state_ids' }, 403);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (auth.role === 'moderator') {
    const stateIds = toNumArray(payload.state_id);
    if (stateIds.length === 0) {
      return json({ error: 'Forbidden: moderator event must target at least one state' }, 403);
    }
    if (!isSubset(stateIds, auth.assigned_state_ids)) {
      return json({ error: 'Forbidden: event includes states outside assignment' }, 403);
    }
    const tg = Array.isArray(payload.target_groups) ? payload.target_groups : [];
    if (tg.length > 0) {
      return json({ error: 'Forbidden: moderators cannot create target_groups events' }, 403);
    }
  }

  // Always set owner on creation (admin + moderator).
  payload.created_by = auth.user.id;

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const { data, error } = await admin.from('events').insert(payload).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ event: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return json({ error: 'Moderator is missing assigned_state_ids' }, 403);
  }

  let body: { id?: string | number; patch?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as any;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const id = body.id != null ? String(body.id).trim() : '';
  const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
  if (!id || !patch) return json({ error: 'Missing id or patch' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  if (auth.role === 'moderator') {
    const { data: ev, error: evErr } = await admin
      .from('events')
      .select('id,state_id,target_groups,created_by')
      .eq('id', id)
      .maybeSingle();
    if (evErr) return json({ error: evErr.message }, 500);
    const owner = String((ev as any)?.created_by ?? '').trim();
    if (!owner || owner !== auth.user.id) return json({ error: 'Forbidden' }, 403);
    const existingStateIds = toNumArray((ev as any)?.state_id);
    if (existingStateIds.length === 0 || !isSubset(existingStateIds, auth.assigned_state_ids)) return json({ error: 'Forbidden' }, 403);
    const nextStateIds = patch.state_id != null ? toNumArray(patch.state_id) : existingStateIds;
    if (nextStateIds.length === 0 || !isSubset(nextStateIds, auth.assigned_state_ids)) return json({ error: 'Forbidden: cannot set states outside assignment' }, 403);
    const nextTargetGroups = patch.target_groups != null ? (Array.isArray(patch.target_groups) ? patch.target_groups : []) : ((ev as any)?.target_groups ?? []);
    if (Array.isArray(nextTargetGroups) && nextTargetGroups.length > 0) return json({ error: 'Forbidden: moderators cannot use target_groups events' }, 403);

    // Never allow moderators to change ownership.
    if (patch.created_by != null) return json({ error: 'Forbidden' }, 403);
  }

  const { data, error } = await admin.from('events').update(patch).eq('id', id).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ event: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return json({ error: 'Moderator is missing assigned_state_ids' }, 403);
  }

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!id) return json({ error: 'Missing id' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  if (auth.role === 'moderator') {
    const { data: ev, error: evErr } = await admin.from('events').select('id,state_id,created_by').eq('id', id).maybeSingle();
    if (evErr) return json({ error: evErr.message }, 500);
    const owner = String((ev as any)?.created_by ?? '').trim();
    if (!owner || owner !== auth.user.id) return json({ error: 'Forbidden' }, 403);
    const stateIds = toNumArray((ev as any)?.state_id);
    if (stateIds.length === 0 || !isSubset(stateIds, auth.assigned_state_ids)) return json({ error: 'Forbidden' }, 403);
  }

  const { error } = await admin.from('events').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

