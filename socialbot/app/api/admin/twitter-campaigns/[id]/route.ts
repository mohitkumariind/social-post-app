import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, toRbacUser, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { RbacError, requireRole } from '@/lib/rbac/require';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import { withAudit } from '@/lib/audit/withAudit';
import {
  TWITTER_CAMPAIGN_RESOURCE,
  isReservedTwitterCampaignPathSegment,
  normalizeTargetParty,
  parseCampaignType,
  parseScheduledAt,
  normalizeVariantsInput,
  variantsToJsonb,
  twitterCampaignIdFromRequest,
  type TwitterCampaignType,
} from '@/app/api/admin/twitter-campaigns/_lib';

const WORKERS_ENDPOINT_HINT =
  'Use POST /api/admin/twitter-campaigns/workers (or legacy /api/admin/twitter-campaign-workers) to run wave and notification workers.';

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

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id?.trim()) return json({ error: 'Missing id' }, 400);
  if (isReservedTwitterCampaignPathSegment(id)) {
    return json({ error: 'Not a campaign id', hint: WORKERS_ENDPOINT_HINT }, 404);
  }

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

  const { data: campaign, error: e1 } = await admin.from('twitter_campaigns').select('*').eq('id', id).maybeSingle();
  if (e1) {
    if (isMissingTableErr(e1, 'twitter_campaigns')) return json({ error: 'twitter_campaigns schema not installed' }, 503);
    return json({ error: e1.message }, 500);
  }
  if (!campaign) return json({ error: 'Not found' }, 404);

  const u = toRbacUser(auth);
  if (
    auth.role !== 'admin' &&
    !canAccessResource(u, { created_by: (campaign as any).created_by }, { resourceType: TWITTER_CAMPAIGN_RESOURCE })
  ) {
    return json({ error: 'Forbidden' }, 403);
  }

  const [{ data: variants, error: e2 }, { data: waves, error: e3 }] = await Promise.all([
    admin.from('twitter_campaign_variants').select('*').eq('campaign_id', id).order('variant_index', { ascending: true }),
    admin.from('twitter_campaign_waves').select('*').eq('campaign_id', id).order('wave_index', { ascending: true }),
  ]);
  if (e2) return json({ error: e2.message }, 500);
  if (e3) return json({ error: e3.message }, 500);

  return json({ campaign, variants: variants ?? [], waves: waves ?? [] });
}

export const PATCH = withAudit(
  async ({ req, auth, admin, previous_data }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    const before = previous_data as Record<string, unknown> | null;
    if (!before) return json({ error: 'Not found' }, 404);
    if (String(before.status) !== 'draft') return json({ error: 'Only draft campaigns can be updated' }, 400);

    const id = twitterCampaignIdFromRequest(req);
    if (!id) return json({ error: 'Missing id' }, 400);
    if (isReservedTwitterCampaignPathSegment(id)) {
      return json({ error: 'Not a campaign id', hint: WORKERS_ENDPOINT_HINT }, 404);
    }

    const u = toRbacUser(auth);
    if (
      auth.role !== 'admin' &&
      !canAccessResource(u, { created_by: before.created_by }, { resourceType: TWITTER_CAMPAIGN_RESOURCE })
    ) {
      return json({ error: 'Forbidden' }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const patch = body.patch && typeof body.patch === 'object' ? (body.patch as Record<string, unknown>) : null;
    if (!patch) return json({ error: 'Missing patch' }, 400);

    const hasAnyField =
      ['title', 'type', 'total_waves', 'gap_minutes', 'scheduled_at', 'target_party', 'description'].some((k) =>
        Object.prototype.hasOwnProperty.call(patch, k)
      ) || Object.prototype.hasOwnProperty.call(patch, 'variants');
    if (!hasAnyField) return json({ error: 'No valid patch fields' }, 400);

    const decision = canPerformMutation(
      u,
      'twitter_campaigns.update',
      { created_by: before.created_by },
      patch,
      { resourceType: TWITTER_CAMPAIGN_RESOURCE, resourceId: id, resourceName: String(before.title ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);

    const safePatch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (patch.title != null) {
      const t = String(patch.title).trim();
      if (!t) return json({ error: 'title cannot be empty' }, 400);
      safePatch.title = t;
    }
    if (patch.type != null) {
      const tp = parseCampaignType(patch.type);
      if (typeof tp === 'object' && tp && 'error' in tp) return json({ error: tp.error }, 400);
      safePatch.type = tp as TwitterCampaignType;
    }
    if (patch.total_waves != null) {
      const n = Number(patch.total_waves);
      if (!Number.isFinite(n) || n < 1) return json({ error: 'total_waves must be an integer >= 1' }, 400);
      safePatch.total_waves = Math.floor(n);
    }
    if (patch.gap_minutes != null) {
      const n = Number(patch.gap_minutes);
      if (!Number.isFinite(n) || n < 0) return json({ error: 'gap_minutes must be a number >= 0' }, 400);
      safePatch.gap_minutes = Math.floor(n);
    }
    if (patch.scheduled_at !== undefined) {
      const s = parseScheduledAt(patch.scheduled_at);
      if (!s.ok) return json({ error: s.error }, 400);
      safePatch.scheduled_at = s.iso;
    }
    if (patch.target_party != null) {
      const p = normalizeTargetParty(patch.target_party);
      if (typeof p !== 'string') return json({ error: p.error }, 400);
      safePatch.target_party = p;
    }
    if (patch.description !== undefined) {
      safePatch.description = patch.description == null ? null : String(patch.description);
    }

    const hasVariantPatch = Object.prototype.hasOwnProperty.call(patch, 'variants');
    if (hasVariantPatch || Object.keys(safePatch).length > 1) {
      const { error: upErr } = await admin.from('twitter_campaigns').update(safePatch as any).eq('id', id);
      if (upErr) return json({ error: upErr.message }, 500);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'variants')) {
      const vr = normalizeVariantsInput(patch.variants);
      if (typeof vr === 'object' && vr && 'error' in vr) return json({ error: vr.error }, 400);
      const { error: rpcErr } = await admin.rpc('twitter_campaign_replace_variants', {
        p_campaign_id: id,
        p_variants: variantsToJsonb(vr as any),
      });
      if (rpcErr) return json({ error: rpcErr.message }, 500);
    }

    const { data: campaign, error: cErr } = await admin.from('twitter_campaigns').select('*').eq('id', id).single();
    if (cErr) return json({ error: cErr.message }, 500);
    const { data: variants } = await admin
      .from('twitter_campaign_variants')
      .select('*')
      .eq('campaign_id', id)
      .order('variant_index', { ascending: true });
    const { data: waves } = await admin
      .from('twitter_campaign_waves')
      .select('*')
      .eq('campaign_id', id)
      .order('wave_index', { ascending: true });

    return json({ campaign, variants: variants ?? [], waves: waves ?? [] });
  },
  {
    action_type: 'twitter_campaigns.update',
    resource_type: TWITTER_CAMPAIGN_RESOURCE,
    severity: 'info',
    undoable: true,
    getPreviousData: async ({ req, admin }) => {
      const cid = twitterCampaignIdFromRequest(req);
      if (!cid) return null;
      const { data } = await admin.from('twitter_campaigns').select('*').eq('id', cid).maybeSingle();
      return data as any;
    },
    build: ({ response_json }) => ({
      resource_id: String(response_json?.campaign?.id ?? ''),
      resource_name: String(response_json?.campaign?.title ?? ''),
      new_data: response_json ?? null,
    }),
  }
);

export const DELETE = withAudit(
  async ({ req, auth, admin, previous_data }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    const before = previous_data as Record<string, unknown> | null;
    if (!before) return json({ error: 'Not found' }, 404);

    const id = twitterCampaignIdFromRequest(req);
    if (!id) return json({ error: 'Missing id' }, 400);
    if (isReservedTwitterCampaignPathSegment(id)) {
      return json({ error: 'Not a campaign id', hint: WORKERS_ENDPOINT_HINT }, 404);
    }

    const u = toRbacUser(auth);
    if (
      auth.role !== 'admin' &&
      !canAccessResource(u, { created_by: before.created_by }, { resourceType: TWITTER_CAMPAIGN_RESOURCE })
    ) {
      return json({ error: 'Forbidden' }, 403);
    }

    const decision = canPerformMutation(
      u,
      'twitter_campaigns.delete',
      { created_by: before.created_by },
      null,
      { resourceType: TWITTER_CAMPAIGN_RESOURCE, resourceId: id, resourceName: String(before.title ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);

    const { error: delErr } = await admin.from('twitter_campaigns').delete().eq('id', id);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true });
  },
  {
    action_type: 'twitter_campaigns.delete',
    resource_type: TWITTER_CAMPAIGN_RESOURCE,
    severity: 'warning',
    undoable: false,
    getPreviousData: async ({ req, admin }) => {
      const cid = twitterCampaignIdFromRequest(req);
      if (!cid) return null;
      const { data } = await admin.from('twitter_campaigns').select('*').eq('id', cid).maybeSingle();
      return data as any;
    },
    build: ({ req, previous_data }) => ({
      resource_id: twitterCampaignIdFromRequest(req),
      resource_name: String((previous_data as any)?.title ?? ''),
    }),
  }
);
