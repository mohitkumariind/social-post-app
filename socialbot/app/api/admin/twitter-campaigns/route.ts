import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, isElevatedDashboardRole, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { RbacError, requireRole } from '@/lib/rbac/require';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import { withAudit } from '@/lib/audit/withAudit';
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, clampLimit } from '@/lib/perf-defaults';
import {
  TWITTER_CAMPAIGN_RESOURCE,
  normalizeTargetParty,
  parseCampaignType,
  parseScheduledAt,
  normalizeVariantsInput,
  variantsToJsonb,
  type TwitterCampaignType,
} from '@/app/api/admin/twitter-campaigns/_lib';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isMissingTableErr(err: { message?: string } | null | undefined, tableName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes(tableName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('relation')))
  );
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const sp = request.nextUrl.searchParams;
  const limit = clampLimit(sp.get('limit'), API_DEFAULT_LIMIT, API_MAX_LIMIT);
  const cursorCreatedAt = (sp.get('cursor_created_at') ?? '').trim();

  const rbacUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };

  let q = admin
    .from('twitter_campaigns')
    .select('*, twitter_campaign_variants(count), twitter_campaign_waves(count)')
    .order('created_at', { ascending: false })
    .limit(limit) as any;
  if (cursorCreatedAt) q = q.lt('created_at', cursorCreatedAt);
  if (!isElevatedDashboardRole(auth.role)) q = q.eq('created_by', auth.user.id);

  const { data, error } = await q;
  if (error) {
    if (isMissingTableErr(error, 'twitter_campaigns')) {
      return json({ campaigns: [], next_cursor_created_at: '', limit });
    }
    return json({ error: error.message }, 500);
  }

  const rows = (data ?? []) as any[];
  const shaped = rows.map((r) => {
    const vc = Array.isArray(r.twitter_campaign_variants) ? r.twitter_campaign_variants[0]?.count : undefined;
    const wc = Array.isArray(r.twitter_campaign_waves) ? r.twitter_campaign_waves[0]?.count : undefined;
    const { twitter_campaign_variants: _a, twitter_campaign_waves: _b, ...rest } = r;
    return {
      ...rest,
      variant_count: typeof vc === 'number' ? vc : 0,
      wave_count: typeof wc === 'number' ? wc : 0,
    };
  });

  const filtered =
    isElevatedDashboardRole(auth.role)
      ? shaped
      : shaped.filter((row) =>
          canAccessResource(rbacUser, { created_by: row.created_by }, { resourceType: TWITTER_CAMPAIGN_RESOURCE })
        );

  const next_cursor_created_at =
    filtered.length > 0 ? String(filtered[filtered.length - 1]?.created_at ?? '') : '';
  return json({ campaigns: filtered, next_cursor_created_at, limit });
}

export const POST = withAudit(
  async ({ req, auth, admin }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const title = String(body.title ?? '').trim();
    if (!title) return json({ error: 'title is required' }, 400);

    const typeParsed = parseCampaignType(body.type);
    if (typeof typeParsed === 'object' && typeParsed && 'error' in typeParsed) return json({ error: typeParsed.error }, 400);
    const type = typeParsed as TwitterCampaignType;

    const totalWaves = Number(body.total_waves);
    const gapMinutes = Number(body.gap_minutes);
    if (!Number.isFinite(totalWaves) || totalWaves < 1) return json({ error: 'total_waves must be an integer >= 1' }, 400);
    if (!Number.isFinite(gapMinutes) || gapMinutes < 0) return json({ error: 'gap_minutes must be a number >= 0' }, 400);

    const partyRes = normalizeTargetParty(body.target_party);
    if (typeof partyRes !== 'string') return json({ error: partyRes.error }, 400);

    const sched = parseScheduledAt(body.scheduled_at);
    if (!sched.ok) return json({ error: sched.error }, 400);

    const variantsRes = normalizeVariantsInput(body.variants);
    if (typeof variantsRes === 'object' && variantsRes && 'error' in variantsRes) return json({ error: variantsRes.error }, 400);

    const row = {
      title,
      type,
      total_waves: Math.floor(totalWaves),
      gap_minutes: Math.floor(gapMinutes),
      scheduled_at: sched.iso,
      target_party: partyRes,
      description: body.description != null ? String(body.description) : null,
      status: 'draft',
      created_by: auth.user.id,
      updated_at: new Date().toISOString(),
    };

    const rbacUser = {
      id: auth.user.id,
      role: auth.role,
      assigned_state_ids: auth.assigned_state_ids,
      assigned_group_ids: auth.assigned_group_ids,
    };

    const decision = canPerformMutation(
      rbacUser,
      'twitter_campaigns.create',
      null,
      { ...row, created_by: auth.user.id } as any,
      { resourceType: TWITTER_CAMPAIGN_RESOURCE, resourceName: title }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);

    const { data: created, error: insErr } = await admin.from('twitter_campaigns').insert(row as any).select('*').single();
    if (insErr) {
      if (isMissingTableErr(insErr, 'twitter_campaigns')) return json({ error: 'twitter_campaigns schema not installed' }, 503);
      return json({ error: insErr.message }, 500);
    }

    const cid = String((created as any)?.id ?? '');
    const { error: rpcErr } = await admin.rpc('twitter_campaign_replace_variants', {
      p_campaign_id: cid,
      p_variants: variantsToJsonb(variantsRes as any),
    });
    if (rpcErr) {
      await admin.from('twitter_campaigns').delete().eq('id', cid);
      if (isMissingTableErr(rpcErr, 'twitter_campaign')) return json({ error: 'twitter_campaigns schema not installed' }, 503);
      return json({ error: rpcErr.message }, 500);
    }

    const { data: variants } = await admin
      .from('twitter_campaign_variants')
      .select('*')
      .eq('campaign_id', cid)
      .order('variant_index', { ascending: true });

    return json({ campaign: created, variants: variants ?? [] });
  },
  {
    action_type: 'twitter_campaigns.create',
    resource_type: TWITTER_CAMPAIGN_RESOURCE,
    severity: 'info',
    undoable: true,
    build: ({ response_json }) => ({
      resource_id: String(response_json?.campaign?.id ?? ''),
      resource_name: String(response_json?.campaign?.title ?? ''),
      new_data: response_json ?? null,
    }),
  }
);
