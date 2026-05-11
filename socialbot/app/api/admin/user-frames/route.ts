import { NextRequest, NextResponse } from 'next/server';
import { assertAdminRole, createServiceRoleClient, isAdmin, isCampaignManager, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery, resolveAllowedProfileIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
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

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json(
      { error: 'Admin frame access requires SUPABASE_SERVICE_ROLE_KEY' },
      { status: 503 }
    );
  }
  const db = admin;
  const adminRole = isAdmin(auth);
  if (adminRole) assertAdminRole(auth);

  // Enforce scope BEFORE querying frames.
  const scopedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  } as any;

  const allowed_profile_ids =
    isCampaignManager(auth) && admin
      ? await resolveAllowedProfileIdsForCampaignManager(admin as any, auth.assigned_group_ids)
      : null;

  {
    if (adminRole) {
      const { data: prof, error: profErr } = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
      if (!prof) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else {
      const profQuery = buildScopedQuery(
        scopedUser,
        db.from('profiles').select('id').eq('id', userId).limit(1) as any,
        'profiles',
        { allowed_profile_ids: Array.isArray(allowed_profile_ids) ? allowed_profile_ids : undefined }
      );
      const { data: prof, error: profErr } = await profQuery.maybeSingle();
      if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
      if (!prof) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // `select('*')` avoids hard failures when optional columns (`overlay_url`, `file_name`, `frame_url`)
  // differ across environments; we normalize below.
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
      { frames: rows, usedServiceRole: !!admin, next_cursor_created_at, limit, offset, has_more },
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
    { frames: rows, usedServiceRole: !!admin, next_cursor_created_at, limit, offset, has_more },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
