import { NextRequest, NextResponse } from 'next/server';
import { assertAdminRole, createServiceRoleClient, isAdmin, isCampaignManager, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery, resolveAllowedProfileIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';
import { RbacError, requireCampaignManagerHasAssignedGroups, requireModeratorHasAssignedStates, requireRole } from '@/lib/rbac/require';
import { API_DEFAULT_FRAMES_LIMIT, API_MAX_FRAMES_LIMIT, clampLimit } from '@/lib/perf-defaults';

/** Normalize DB row for admin UI + mobile (`url` vs legacy `frame_url`). */
function normalizeUserFrameRow(r: Record<string, unknown>) {
  const url = String((r as { url?: unknown; frame_url?: unknown }).url ?? (r as { frame_url?: unknown }).frame_url ?? '').trim();
  const overlay = (r as { overlay_url?: unknown }).overlay_url;
  return {
    id: (r as { id?: unknown }).id,
    url,
    overlay_url: overlay != null && String(overlay).trim() !== '' ? String(overlay).trim() : undefined,
    created_at: (r as { created_at?: unknown }).created_at ?? null,
    file_name: (r as { file_name?: unknown }).file_name,
  };
}

const isMissingColumnErr = (err: { message?: string } | null | undefined, columnName: string) => {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
};

type AdminAuth = Extract<Awaited<ReturnType<typeof validateAdminSession>>, { ok: true }>;

async function requireAdminSessionOrJson() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return {
      error: NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status }),
    } as const;
  }
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
    requireCampaignManagerHasAssignedGroups(auth);
  } catch (e) {
    if (e instanceof RbacError) return { error: NextResponse.json({ error: e.message }, { status: e.status }) } as const;
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }
  return { supabase, auth } as const;
}

async function ensureTargetProfileInScope(
  db: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  auth: AdminAuth,
  adminRole: boolean,
  targetUserId: string,
  allowed_profile_ids: string[] | null,
  scopedUser: { id: string; role: string; assigned_state_ids: number[]; assigned_group_ids: string[] }
): Promise<NextResponse | null> {
  if (adminRole) {
    const { data: prof, error: profErr } = await db.from('profiles').select('id').eq('id', targetUserId).maybeSingle();
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else {
    const profQuery = buildScopedQuery(
      scopedUser as any,
      db.from('profiles').select('id').eq('id', targetUserId).limit(1) as any,
      'profiles',
      { allowed_profile_ids: Array.isArray(allowed_profile_ids) ? allowed_profile_ids : undefined }
    );
    const { data: prof, error: profErr } = await profQuery.maybeSingle();
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

async function profileScopeResourceForFrames(
  db: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  userId: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from('profiles')
    .select('id,group_id,state_id,assigned_state_ids')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { group_id?: unknown; state_id?: unknown; assigned_state_ids?: unknown };
  return {
    user_id: userId,
    group_id: row.group_id,
    state_id: row.state_id,
    assigned_state_ids: row.assigned_state_ids,
  };
}

function mutationUserFromGate(auth: AdminAuth) {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

function serviceDbOr503() {
  const admin = createServiceRoleClient();
  if (!admin) {
    return {
      error: NextResponse.json(
        { error: 'Admin frame access requires SUPABASE_SERVICE_ROLE_KEY' },
        { status: 503 }
      ),
    } as const;
  }
  return { db: admin } as const;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminSessionOrJson();
  if ('error' in gate) return gate.error;

  const userId = (request.nextUrl.searchParams.get('user_id') ?? '').trim();
  const searchQuery = (request.nextUrl.searchParams.get('search_query') ?? '').trim();
  const limit = clampLimit(request.nextUrl.searchParams.get('limit'), API_DEFAULT_FRAMES_LIMIT, API_MAX_FRAMES_LIMIT);
  const cursorCreatedAt = (request.nextUrl.searchParams.get('cursor_created_at') ?? '').trim();
  const offsetRaw = (request.nextUrl.searchParams.get('offset') ?? '').trim();
  let offset = 0;
  if (offsetRaw !== '') {
    const n = Number(offsetRaw);
    if (Number.isFinite(n) && n >= 0) offset = Math.min(Math.trunc(n), 1_000_000);
  }
  if (!userId) {
    return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
  }

  const svc = serviceDbOr503();
  if ('error' in svc) return svc.error;
  const db = svc.db;
  const adminRole = isAdmin(gate.auth);
  if (adminRole) assertAdminRole(gate.auth);

  const scopedUser = {
    id: gate.auth.user.id,
    role: gate.auth.role,
    assigned_state_ids: gate.auth.assigned_state_ids,
    assigned_group_ids: gate.auth.assigned_group_ids,
  } as any;

  const allowed_profile_ids =
    isCampaignManager(gate.auth) && db
      ? await resolveAllowedProfileIdsForCampaignManager(db as any, gate.auth.assigned_group_ids)
      : null;

  const scopeErr = await ensureTargetProfileInScope(db, gate.auth as AdminAuth, adminRole, userId, allowed_profile_ids, scopedUser);
  if (scopeErr) return scopeErr;

  const baseStar = () =>
    db.from('user_frames').select('*').eq('user_id', userId).order('id', { ascending: true }).range(offset, offset + limit - 1) as any;

  if (!searchQuery) {
    let q = baseStar();
    if (offset === 0 && cursorCreatedAt) q = q.lt('created_at', cursorCreatedAt);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => normalizeUserFrameRow(r));
    const next_cursor_created_at = rows.length > 0 ? String(rows[rows.length - 1]?.created_at ?? '') : '';
    const has_more = rows.length === limit;
    return NextResponse.json(
      { frames: rows, usedServiceRole: !!db, next_cursor_created_at, limit, offset, has_more },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let qSearch: any = baseStar().ilike('file_name', `%${searchQuery}%`);
  if (offset === 0 && cursorCreatedAt) qSearch = qSearch.lt('created_at', cursorCreatedAt);
  let res: any = await qSearch;
  if (res.error && isMissingColumnErr(res.error, 'file_name')) {
    let qFallback: any = db
      .from('user_frames')
      .select('*')
      .eq('user_id', userId)
      .ilike('url', `%${searchQuery}%`)
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    if (offset === 0 && cursorCreatedAt) qFallback = qFallback.lt('created_at', cursorCreatedAt);
    res = (await qFallback) as any;
  }

  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  const rows = ((res.data ?? []) as Record<string, unknown>[]).map((r) => normalizeUserFrameRow(r));
  const next_cursor_created_at = rows.length > 0 ? String(rows[rows.length - 1]?.created_at ?? '') : '';
  const has_more = rows.length === limit;
  return NextResponse.json(
    { frames: rows, usedServiceRole: !!db, next_cursor_created_at, limit, offset, has_more },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Insert user frame (service role) — browser must not rely on PostgREST select lists or RLS for admin uploads. */
export async function POST(request: NextRequest) {
  const gate = await requireAdminSessionOrJson();
  if ('error' in gate) return gate.error;

  let body: { user_id?: unknown; url?: unknown; overlay_url?: unknown; file_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userId = String(body.user_id ?? '').trim();
  const url = String(body.url ?? '').trim();
  if (!userId || !url) {
    return NextResponse.json({ error: 'Missing user_id or url' }, { status: 400 });
  }

  const svc = serviceDbOr503();
  if ('error' in svc) return svc.error;
  const db = svc.db;
  const adminRole = isAdmin(gate.auth);
  if (adminRole) assertAdminRole(gate.auth);

  const scopedUser = {
    id: gate.auth.user.id,
    role: gate.auth.role,
    assigned_state_ids: gate.auth.assigned_state_ids,
    assigned_group_ids: gate.auth.assigned_group_ids,
  } as any;

  const allowed_profile_ids =
    isCampaignManager(gate.auth) && db
      ? await resolveAllowedProfileIdsForCampaignManager(db as any, gate.auth.assigned_group_ids)
      : null;

  const scopeErr = await ensureTargetProfileInScope(db, gate.auth as AdminAuth, adminRole, userId, allowed_profile_ids, scopedUser);
  if (scopeErr) return scopeErr;

  const scopeResource = await profileScopeResourceForFrames(db, userId);
  if (!scopeResource) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const overlayIn = String(body.overlay_url ?? '').trim();
  const fileName = String(body.file_name ?? '').trim();

  let insertPayload: Record<string, unknown> = {
    user_id: userId,
    url,
    overlay_url: overlayIn || url,
  };
  if (fileName) insertPayload.file_name = fileName;

  {
    const decision = canPerformMutation(
      mutationUserFromGate(gate.auth as AdminAuth),
      'user_frames.create',
      scopeResource,
      insertPayload,
      { resourceType: 'user_frames', resourceId: userId, resourceName: fileName || userId }
    );
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  let ins = await db.from('user_frames').insert(insertPayload).select('*').maybeSingle();
  for (let attempts = 0; attempts < 6 && ins.error; attempts++) {
    const msg = String((ins.error as { message?: string })?.message ?? '');
    const m = msg.match(/'([^']+)' column/i) ?? msg.match(/column ['\"]([^'\"]+)['\"]/i) ?? msg.match(/Could not find the '([^']+)' column/i);
    const missing = m?.[1]?.trim();
    if (missing && Object.prototype.hasOwnProperty.call(insertPayload, missing)) {
      delete (insertPayload as any)[missing];
      ins = await db.from('user_frames').insert(insertPayload).select('*').maybeSingle();
      continue;
    }
    break;
  }

  if (ins.error) {
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }
  const frame = normalizeUserFrameRow((ins.data ?? {}) as Record<string, unknown>);
  return NextResponse.json({ frame }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Delete one frame row after scope check (service role). */
export async function DELETE(request: NextRequest) {
  const gate = await requireAdminSessionOrJson();
  if ('error' in gate) return gate.error;

  const frameId = (request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!frameId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const svc = serviceDbOr503();
  if ('error' in svc) return svc.error;
  const db = svc.db;
  const adminRole = isAdmin(gate.auth);
  if (adminRole) assertAdminRole(gate.auth);

  const scopedUser = {
    id: gate.auth.user.id,
    role: gate.auth.role,
    assigned_state_ids: gate.auth.assigned_state_ids,
    assigned_group_ids: gate.auth.assigned_group_ids,
  } as any;

  const allowed_profile_ids =
    isCampaignManager(gate.auth) && db
      ? await resolveAllowedProfileIdsForCampaignManager(db as any, gate.auth.assigned_group_ids)
      : null;

  const { data: row, error: rowErr } = await db.from('user_frames').select('id,user_id').eq('id', frameId).maybeSingle();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ownerId = String((row as { user_id?: unknown }).user_id ?? '').trim();
  if (!ownerId) {
    return NextResponse.json({ error: 'Invalid frame row' }, { status: 500 });
  }

  const scopeErr = await ensureTargetProfileInScope(db, gate.auth as AdminAuth, adminRole, ownerId, allowed_profile_ids, scopedUser);
  if (scopeErr) return scopeErr;

  const scopeResource = await profileScopeResourceForFrames(db, ownerId);
  if (!scopeResource) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  {
    const decision = canPerformMutation(
      mutationUserFromGate(gate.auth as AdminAuth),
      'user_frames.delete',
      scopeResource,
      null,
      { resourceType: 'user_frames', resourceId: frameId, resourceName: ownerId }
    );
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  const { error: delErr } = await db.from('user_frames').delete().eq('id', frameId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
