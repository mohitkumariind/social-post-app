import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery, resolveAllowedProfileIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';

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
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return NextResponse.json({ error: 'Moderator is missing assigned_state_ids' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const sp = request.nextUrl.searchParams;
  const party = (sp.get('party') ?? '').trim();
  const state = (sp.get('state') ?? '').trim();
  const loksabhaIdRaw = (sp.get('loksabha_id') ?? '').trim();
  const assemblyIdRaw = (sp.get('assembly_id') ?? '').trim();
  const searchQueryRaw = (sp.get('search_query') ?? '').trim();

  const loksabha_id = loksabhaIdRaw ? Number(loksabhaIdRaw) : null;
  const assembly_id = assemblyIdRaw ? Number(assemblyIdRaw) : null;

  const buildQuery = (orderBy: 'created_at' | 'id') => {
    // Moderators must not receive personal info from this endpoint.
    const selectCols =
      auth.role === 'moderator' || auth.role === 'campaign_manager'
        ? 'id,name,avatar_url,assigned_state_ids'
        : '*';
    let q = db.from('profiles').select(selectCols);

    if (auth.role === 'moderator') {
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

    return q.order(orderBy, { ascending: false });
  };

  // Prefer created_at desc. If schema lacks created_at, fall back to id desc.
  let data: unknown[] | null = null;
  let error: { message?: string } | null = null;

  let cmAllowedProfileIds: string[] | null = null;
  if (auth.role === 'campaign_manager' && admin) {
    // Prefer membership-based IDs; if table missing, fall back inside buildScopedQuery.
    const hasM = await hasGroupMembershipsTable(db);
    if (hasM) cmAllowedProfileIds = await resolveAllowedProfileIdsForCampaignManager(admin, auth.assigned_group_ids);
  }

  {
    let q = buildQuery('created_at') as any;
    if (auth.role === 'campaign_manager') {
      q = buildScopedQuery(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        q,
        'profiles',
        { allowed_profile_ids: Array.isArray(cmAllowedProfileIds) ? cmAllowedProfileIds : undefined }
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
      if (auth.role === 'campaign_manager') {
        q2 = buildScopedQuery(
          { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
          q2,
          'profiles',
          { allowed_profile_ids: Array.isArray(cmAllowedProfileIds) ? cmAllowedProfileIds : undefined }
        );
      }
      const res2 = await q2;
      data = (res2 as any).data ?? null;
      error = (res2 as any).error ?? null;
    }
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { profiles: data ?? [], usedServiceRole: !!admin },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  if (auth.role === 'moderator') {
    return NextResponse.json({ error: 'Moderators cannot delete users' }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const { error } = await db.from('profiles').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

type PatchBody = {
  id?: string;
  role?: 'user' | 'moderator' | 'admin' | string;
  assigned_state_ids?: unknown;
  assigned_group_ids?: unknown;
};

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

  const roleRaw = String(body.role ?? '').trim().toLowerCase();
  const role = roleRaw === 'admin' || roleRaw === 'moderator' || roleRaw === 'campaign_manager' || roleRaw === 'user' ? roleRaw : '';
  if (!role) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

  let assigned_state_ids = toNumArr(body.assigned_state_ids);
  if (role !== 'moderator') assigned_state_ids = [];
  if (role === 'moderator' && assigned_state_ids.length === 0) {
    return NextResponse.json({ error: 'assigned_state_ids is required for moderators' }, { status: 400 });
  }

  let assigned_group_ids = toStrArr(body.assigned_group_ids);
  if (role !== 'campaign_manager') assigned_group_ids = [];
  if (role === 'campaign_manager' && assigned_group_ids.length === 0) {
    return NextResponse.json({ error: 'assigned_group_ids is required for campaign managers' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 503 });
  }

  const { data, error } = await admin
    .from('profiles')
    .update({ role, assigned_state_ids, assigned_group_ids })
    .eq('id', id)
    .select('id, role, assigned_state_ids, assigned_group_ids')
    .single();

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
