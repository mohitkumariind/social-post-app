import { NextResponse } from 'next/server';
import { isElevatedDashboardRole, toRbacUser } from '@/lib/admin-gate';
import { withAudit } from '@/lib/audit/withAudit';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import { RbacError, requireRole } from '@/lib/rbac/require';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { TWITTER_CAMPAIGN_RESOURCE, twitterCampaignIdFromRequest, type TwitterCampaignRow } from '@/app/api/admin/twitter-campaigns/_lib';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const POST = withAudit(
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

    const u = toRbacUser(auth);
    if (
      !isElevatedDashboardRole(auth.role) &&
      !canAccessResource(u, { created_by: before.created_by }, { resourceType: TWITTER_CAMPAIGN_RESOURCE })
    ) {
      return json({ error: 'Forbidden' }, 403);
    }

    const decision = canPerformMutation(
      u,
      'twitter_campaigns.cancel_waves',
      { created_by: before.created_by },
      null,
      { resourceType: TWITTER_CAMPAIGN_RESOURCE, resourceId: id, resourceName: String(before.title ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);

    const { data: rpcRes, error: rpcErr } = await admin.rpc('twitter_campaign_cancel_remaining_waves', {
      p_campaign_id: id,
    });
    if (rpcErr) return json({ error: rpcErr.message }, 500);
    const body = (rpcRes ?? {}) as { ok?: boolean; error?: string };
    if (!body.ok) return json(body, 404);

    const { data: campaign, error: cErr } = await admin.from('twitter_campaigns').select('*').eq('id', id).single();
    if (cErr) return json({ error: cErr.message }, 500);

    return json({ campaign, rpc: rpcRes });
  },
  {
    action_type: 'twitter_campaigns.cancel_waves',
    resource_type: TWITTER_CAMPAIGN_RESOURCE,
    severity: 'warning',
    undoable: false,
    getPreviousData: async ({ req, admin }) => {
      const cid = twitterCampaignIdFromRequest(req);
      if (!cid) return null;
      const { data } = await admin.from('twitter_campaigns').select('*').eq('id', cid).maybeSingle();
      return data as TwitterCampaignRow | null;
    },
    build: ({ response_json }) => ({
      resource_id: String(response_json?.campaign?.id ?? ''),
      resource_name: String(response_json?.campaign?.title ?? ''),
      new_data: response_json ?? null,
    }),
  }
);
