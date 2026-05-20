import { NextRequest, NextResponse } from 'next/server';
import {
  assertAdminRole,
  createServiceRoleClient,
  isAdmin,
  isCampaignManager,
  isModerator,
  validateAdminSession,
} from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  buildScopedQuery,
  resolveAllowedProfileIdsForCampaignManager,
  resolveEffectiveGroupIdsForCampaignManager,
} from '@/lib/rbac/scoped-query-builder';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { normalizeProfileRole } from '@/lib/profile-roles';
import { RbacError, requireCampaignManagerHasAssignedGroups, requireRole } from '@/lib/rbac/require';
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, clampLimit } from '@/lib/perf-defaults';

function toNumArr(v: unknown): number[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => (typeof x === 'number' ? x : Number(x)))
    .filter((n) => Number.isFinite(n));
}

function isMissingTableErr(err: { message?: string } | null | undefined, tableName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(tableName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found'));
}

async function hasGroupMembershipsTable(db: any): Promise<boolean> {
  const r = await db.from('group_memberships').select('group_id', { count: 'exact', head: true }).limit(1);
  if ((r as any)?.error && isMissingTableErr((r as any).error, 'group_memberships')) return false;
  return true;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (isModerator(auth) && auth.assigned_state_ids.length === 0) {
    return NextResponse.json({ error: 'Moderator is missing assigned_state_ids' }, { status: 403 });
  }
  const admin = createServiceRoleClient();
  if (!admin) {
    // No JWT fallback in /api/admin/*: avoid implicit RLS-scoped reads.
    return NextResponse.json(
      { error: 'Admin list access requires SUPABASE_SERVICE_ROLE_KEY' },
      { status: 503 }
    );
  }
  const db = admin;
  const adminRole = isAdmin(auth);
  if (adminRole) assertAdminRole(auth);

  let cmEffectiveGroupIds: string[] | undefined;
  if (isCampaignManager(auth)) {
    const eff = await resolveEffectiveGroupIdsForCampaignManager(db, auth.user.id, auth.assigned_group_ids);
    if (eff === null) {
      return NextResponse.json({ error: 'Unable to resolve group assignments' }, { status: 500 });
    }
    if (eff.length === 0) {
      return NextResponse.json({ error: 'Campaign manager is missing assigned_group_ids' }, { status: 403 });
    }
    cmEffectiveGroupIds = eff;
  }

  const sp = request.nextUrl.searchParams;
  const party = (sp.get('party') ?? '').trim();
  const state = (sp.get('state') ?? '').trim();
  const loksabhaIdRaw = (sp.get('loksabha_id') ?? '').trim();
  const assemblyIdRaw = (sp.get('assembly_id') ?? '').trim();
  const searchQueryRaw = (sp.get('search_query') ?? '').trim();
  const requestedLimit = clampLimit(sp.get('limit'), API_DEFAULT_LIMIT, API_MAX_LIMIT);
  const limit = adminRole ? API_MAX_LIMIT : requestedLimit;
  const cursorCreatedAt = (sp.get('cursor_created_at') ?? '').trim();
  const cursorId = (sp.get('cursor_id') ?? '').trim();

  const loksabha_id = loksabhaIdRaw ? Number(loksabhaIdRaw) : null;
  const assembly_id = assemblyIdRaw ? Number(assemblyIdRaw) : null;

  const buildQuery = (orderBy: 'created_at' | 'id') => {
    // Moderators must not receive personal info from this endpoint.
    const selectCols =
      isModerator(auth) || isCampaignManager(auth)
        ? 'id,name,avatar_url,assigned_state_ids'
        : '*';
    let q = db.from('profiles').select(selectCols);

    if (!adminRole && isModerator(auth)) {
      q = buildScopedQuery(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        q,
        'profiles'
      );
    }
    if (party) q = q.eq('party', party);
    if (state) q = q.eq('state', state);
    if (loksabha_id != null && !Number.isNaN(loksabha_id)) q = q.eq('loksabha_id', loksabha_id);
    if (assembly_id != null && !Number.isNaN(assembly_id)) q = q.eq('assembly_id', assembly_id);

    if (searchQueryRaw) {
      const s = searchQueryRaw.replace(/[%]/g, '\\%');
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    q = q.order(orderBy, { ascending: false }).limit(limit);
    if (orderBy === 'created_at' && cursorCreatedAt) q = q.lt('created_at', cursorCreatedAt);
    if (orderBy === 'id' && cursorId) q = q.lt('id', cursorId);
    return q;
  };

  // Prefer created_at desc. If schema lacks created_at, fall back to id desc.
  let data: unknown[] | null = null;
  let error: { message?: string } | null = null;

  let cmAllowedProfileIds: string[] | null = null;
  if (isCampaignManager(auth) && admin && cmEffectiveGroupIds) {
    const hasM = await hasGroupMembershipsTable(db);
    if (hasM) cmAllowedProfileIds = await resolveAllowedProfileIdsForCampaignManager(admin, cmEffectiveGroupIds);
  }

  {
    let q = buildQuery('created_at') as any;
    if (!adminRole && isCampaignManager(auth)) {
      q = buildScopedQuery(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        q,
        'profiles',
        {
          allowed_profile_ids: Array.isArray(cmAllowedProfileIds) ? cmAllowedProfileIds : undefined,
          effective_group_ids: cmEffectiveGroupIds,
        }
      );
    }
    const res = await q;
    data = (res as any).data ?? null;
    error = (res as any).error ?? null;
  }

  if (error) {
    const msg = String(error.message ?? '');
    const looksLikeMissingCreatedAt =
      msg.toLowerCase().includes('created_at') ||
      msg.toLowerCase().includes('column') ||
      msg.toLowerCase().includes('does not exist');
    if (looksLikeMissingCreatedAt) {
      let q2 = buildQuery('id') as any;
      if (!adminRole && isCampaignManager(auth)) {
        q2 = buildScopedQuery(
          { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
          q2,
          'profiles',
          {
            allowed_profile_ids: Array.isArray(cmAllowedProfileIds) ? cmAllowedProfileIds : undefined,
            effective_group_ids: cmEffectiveGroupIds,
          }
        );
      }
      const res2 = await q2;
      data = (res2 as any).data ?? null;
      error = (res2 as any).error ?? null;
    }
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as any[];
  const next_cursor_created_at = rows.length > 0 ? String(rows[rows.length - 1]?.created_at ?? '') : '';
  const next_cursor_id = rows.length > 0 ? String(rows[rows.length - 1]?.id ?? '') : '';
  return NextResponse.json(
    { profiles: rows, usedServiceRole: !!admin, limit, next_cursor_created_at, next_cursor_id },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  try {
    requireRole(auth, ['admin', 'campaign_manager']);
    requireCampaignManagerHasAssignedGroups(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json(
      { error: 'Admin profile mutation requires SUPABASE_SERVICE_ROLE_KEY' },
      { status: 503 }
    );
  }
  const db = admin;

  const scopedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  } as any;

  if (isCampaignManager(auth)) {
    const cmAllowedProfileIds = admin ? await resolveAllowedProfileIdsForCampaignManager(admin, auth.assigned_group_ids) : null;
    // Enforce membership-based scope when possible; fall back to legacy `profiles.group_id` scoping in buildScopedQuery.
    const { data: rows, error: readErr } = await buildScopedQuery(
      scopedUser,
      db.from('profiles').select('id,group_id').eq('id', id).limit(1) as any,
      'profiles',
      { allowed_profile_ids: Array.isArray(cmAllowedProfileIds) ? cmAllowedProfileIds : undefined }
    ).maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    if (!rows) {
      // Audit denied attempt.
      canPerformMutation(
        scopedUser,
        'profiles.delete',
        { group_id: '__outside__' } as any,
        { id } as any,
        { resourceType: 'profiles', resourceId: id }
      );
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const ok = canAccessResource(
      scopedUser,
      { group_id: String((rows as any).group_id ?? '').trim() } as any,
      {
        resourceType: 'profiles',
        audit: { resourceType: 'profiles', action: 'profiles.read', resourceId: id },
      }
    );
    if (!ok) {
      canPerformMutation(
        scopedUser,
        'profiles.delete',
        { group_id: String((rows as any).group_id ?? '').trim() } as any,
        { id } as any,
        { resourceType: 'profiles', resourceId: id }
      );
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const decision = canPerformMutation(
      scopedUser,
      'profiles.delete',
      { group_id: String((rows as any).group_id ?? '').trim() } as any,
      null,
      { resourceType: 'profiles', resourceId: id }
    );
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  const { error } = await db.from('profiles').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

type PatchBody = {
  id?: string;
  role?: string;
  assigned_state_ids?: unknown;
  assigned_group_ids?: unknown;
  assigned_party_ids?: unknown;
};

function toPartySlugArr(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x) => String(x ?? '').trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== 'all');
}

function toStrArr(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => String(x ?? '').trim()).filter(Boolean);
}

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('schema cache'));
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can update roles' }, { status: 403 });
  }

  let body: PatchBody = {};
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = String(body.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const role = normalizeProfileRole(body.role);
  if (!role) {
    return NextResponse.json(
      { error: 'Invalid role. Allowed: worker, moderator, user, admin, editor, super_admin, campaign_manager' },
      { status: 400 }
    );
  }

  let assigned_state_ids = toNumArr(body.assigned_state_ids);
  if (role !== 'moderator' && role !== 'editor') assigned_state_ids = [];
  if ((role === 'moderator' || role === 'editor') && assigned_state_ids.length === 0) {
    return NextResponse.json(
      { error: `assigned_state_ids is required for ${role === 'editor' ? 'editors' : 'moderators'}` },
      { status: 400 }
    );
  }

  let assigned_group_ids = toStrArr(body.assigned_group_ids);
  if (role !== 'campaign_manager') assigned_group_ids = [];
  if (role === 'campaign_manager' && assigned_group_ids.length === 0) {
    return NextResponse.json({ error: 'assigned_group_ids is required for campaign managers' }, { status: 400 });
  }

  let assigned_party_ids = toPartySlugArr(body.assigned_party_ids);
  if (role !== 'moderator' && role !== 'editor') assigned_party_ids = [];

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 503 });
  }

  let updateBody: Record<string, unknown> = { role, assigned_state_ids, assigned_group_ids, assigned_party_ids };
  let selectCols = 'id, role, assigned_state_ids, assigned_group_ids, assigned_party_ids';
  let { data, error } = await admin.from('profiles').update(updateBody).eq('id', id).select(selectCols).single();

  if (error && isMissingColumnErr(error as any, 'assigned_party_ids')) {
    updateBody = { role, assigned_state_ids, assigned_group_ids };
    selectCols = 'id, role, assigned_state_ids, assigned_group_ids';
    ({ data, error } = await admin.from('profiles').update(updateBody).eq('id', id).select(selectCols).single());
  }

  if (error) {
    if (isMissingColumnErr(error as any, 'assigned_group_ids')) {
      return NextResponse.json(
        {
          error:
            "DB schema missing column profiles.assigned_group_ids. Apply the migration and refresh Supabase schema cache, then retry.",
          schemaMissing: true,
          missingColumn: 'assigned_group_ids',
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, profile: data }, { headers: { 'Cache-Control': 'no-store' } });
}
