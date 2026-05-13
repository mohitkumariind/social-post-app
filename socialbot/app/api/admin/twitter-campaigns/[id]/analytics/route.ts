import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { RbacError, requireRole } from '@/lib/rbac/require';
import { TWITTER_CAMPAIGN_RESOURCE } from '@/app/api/admin/twitter-campaigns/_lib';

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

function rbacUser(auth: {
  user: { id: string };
  role: 'admin' | 'moderator' | 'campaign_manager';
  assigned_state_ids: number[];
  assigned_group_ids: string[];
}) {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id?.trim()) return json({ error: 'Missing id' }, 400);

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

  const { data: campaign, error: e1 } = await admin.from('twitter_campaigns').select('id, created_by').eq('id', id).maybeSingle();
  if (e1) {
    if (isMissingTableErr(e1, 'twitter_campaigns')) return json({ error: 'twitter_campaigns schema not installed' }, 503);
    return json({ error: e1.message }, 500);
  }
  if (!campaign) return json({ error: 'Not found' }, 404);

  const u = rbacUser(auth);
  if (
    auth.role !== 'admin' &&
    !canAccessResource(u, { created_by: (campaign as any).created_by }, { resourceType: TWITTER_CAMPAIGN_RESOURCE })
  ) {
    return json({ error: 'Forbidden' }, 403);
  }

  const { data: analytics, error: e2 } = await admin.rpc('twitter_campaign_admin_analytics', {
    p_campaign_id: id,
  });

  if (e2) {
    const msg = String(e2.message ?? '').toLowerCase();
    if (msg.includes('twitter_campaign_admin_analytics') || msg.includes('campaign_events')) {
      if (isMissingTableErr(e2, 'campaign_events')) {
        return json({ error: 'campaign_events schema not installed', detail: e2.message }, 503);
      }
    }
    return json({ error: e2.message }, 500);
  }

  return json({ campaign_id: id, analytics: analytics ?? null });
}
