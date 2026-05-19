import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { resolveAdminAnalyticsScope } from '@/lib/admin/analyticsApi';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  RbacError,
  requireCampaignManagerHasAssignedGroups,
  requireModeratorHasAssignedStates,
  requireRole,
} from '@/lib/rbac/require';

/**
 * Validates the session, assignment integrity, and **server-resolved** analytics scope
 * before any analytics RPC or scoped query runs. Call this first in every `/api/admin/analytics/*` route.
 */
export async function requireAdminAnalyticsContext(): Promise<
  | { ok: true; admin: SupabaseClient; scope: AdminAnalyticsScope; auth: VerifiedAdminAuth }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const session = await validateAdminSession(supabase);
  if (!session.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: session.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: session.status }
      ),
    };
  }
  try {
    requireRole(session, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(session);
    requireCampaignManagerHasAssignedGroups(session);
  } catch (e) {
    if (e instanceof RbacError) {
      return { ok: false, response: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    throw e;
  }
  const admin = createServiceRoleClient();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY required for analytics' }, { status: 503 }),
    };
  }
  const auth: VerifiedAdminAuth = {
    role: session.role,
    user: { id: session.user.id },
    assigned_state_ids: session.assigned_state_ids,
    assigned_group_ids: session.assigned_group_ids,
  };
  const scoped = await resolveAdminAnalyticsScope(admin, auth);
  if (!scoped.ok) {
    return { ok: false, response: NextResponse.json({ error: scoped.error }, { status: scoped.status }) };
  }
  return { ok: true, admin, scope: scoped.scope, auth };
}
