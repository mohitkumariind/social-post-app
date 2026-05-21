import Expo from 'expo-server-sdk';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import {
  BROADCAST_EVENT_CAMPAIGN_REQUIRES_EVENT_MSG,
  optionalEventIdFromPayload,
  remergeLockedEventCampaignAttribution,
  resolveBroadcastEventIdForIntegrity,
  runBroadcast,
  snapshotEventCampaignEventIdForAttribution,
  stripEventIdUnlessEventCampaign,
  type BroadcastPayload,
} from '@/lib/broadcast-send';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import type { UnifiedUser } from '@/lib/rbac/unified-scope-engine';
import { RbacError, requireStandardRbacContext } from '@/lib/rbac/require';
import { logPermissionDecision } from '@/lib/rbac/permission-audit';
import { applyCanonicalNotificationTargeting, filterRecipientProfileIdsForAdmin, type NotificationAuth } from '@/lib/rbac/notification-targeting';
import { normalizeBroadcastIncomingRequest } from '@/lib/broadcast-api-request';
import { filterUsersAllowedForEventResend } from '@/lib/admin/notification-resend-cooldown';

export const runtime = 'nodejs';

function toNotificationAuth(
  auth: Extract<Awaited<ReturnType<typeof validateAdminSession>>, { ok: true }>
): NotificationAuth {
  return {
    user: { id: auth.user.id },
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Admin broadcast: preview (counts) or send via Expo Push API (expo-server-sdk).
 * Tokens come from `public.push_tokens` (Expo tokens from the mobile app — not profiles.expo_push_token).
 *
 * **Request body (v2, preferred):**
 * ```json
 * {
 *   "title": "...",
 *   "message": "...",
 *   "broadcast_mode": "event" | "global",
 *   "event_id": "<uuid> | null",
 *   "audience_filters": { "all_workers": true, "party": null, "state": null, ... },
 *   "preview_only": false,
 *   "image_url": null,
 *   "filter_labels": {},
 *   "target_user_ids": []
 * }
 * ```
 * - **`broadcast_mode === "event"`** → `event_id` **required** (valid UUID). Maps to `data.type: "event_campaign"`.
 * - **`broadcast_mode === "global"`** → `event_id` **must be null or omitted**. Maps to `data.type: "broadcast"`.
 *
 * Legacy **`BroadcastPayload`** (`body`, `filters`, `data.type`, …) is still accepted for older clients.
 *
 * **Persistence & push:** On successful send, `event_id` is stored on **`notification_broadcasts.event_id`**
 * and included in each Expo message’s **`data.event_id`** when present.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const norm = normalizeBroadcastIncomingRequest(raw);
  if (!norm.ok) return json({ error: norm.error }, norm.status ?? 400);
  let payload = norm.payload;

  payload = stripEventIdUnlessEventCampaign(payload);

  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return json(
      { error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' },
      auth.status
    );
  }
  try {
    requireStandardRbacContext(auth, ['admin', 'moderator', 'campaign_manager']);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const rawEventId = (payload as { event_id?: unknown }).event_id;
  if (rawEventId != null && String(rawEventId).trim() !== '') {
    const normalized = optionalEventIdFromPayload({ ...payload, event_id: String(rawEventId) });
    if (normalized == null) {
      return json({ error: 'Invalid event_id: expected a UUID' }, 400);
    }
    payload = { ...payload, event_id: normalized };
  }

  const lockedEventCampaignId = snapshotEventCampaignEventIdForAttribution(payload);

  const admin = createServiceRoleClient();
  if (!admin) {
    return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  }

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const expo = new Expo(accessToken ? { accessToken } : undefined);

  try {
    const na = toNotificationAuth(auth);
    payload = applyCanonicalNotificationTargeting(na, payload, 'notifications.scope.validate');

    const rawTargets = (payload as { target_user_ids?: unknown }).target_user_ids;
    if (Array.isArray(rawTargets) && rawTargets.length > 0) {
      const filtered = await filterRecipientProfileIdsForAdmin(admin, na, rawTargets as string[]);
      if (!filtered.ok) return json({ error: filtered.error }, 400);
      if (filtered.ids.length === 0) {
        return json({ error: 'No recipients remain in your scope for the selected users' }, 400);
      }
      payload = { ...payload, target_user_ids: filtered.ids, all_workers: false };
    }

    const eventIdForCooldown = optionalEventIdFromPayload(payload);
    const targetsAfterScope = (payload as { target_user_ids?: unknown }).target_user_ids;
    if (
      eventIdForCooldown &&
      Array.isArray(targetsAfterScope) &&
      targetsAfterScope.length > 0
    ) {
      const cooldown = await filterUsersAllowedForEventResend(
        admin,
        eventIdForCooldown,
        targetsAfterScope as string[]
      );
      if (!cooldown.ok) return json({ error: cooldown.error }, 500);
      if (cooldown.allowed.length === 0) {
        return json(
          {
            error:
              'All selected users were notified for this event within the last hour. Wait before resending.',
          },
          429
        );
      }
      payload = { ...payload, target_user_ids: cooldown.allowed, all_workers: false };
    }

    payload = remergeLockedEventCampaignAttribution(payload, lockedEventCampaignId);

    {
      const mutationUser: UnifiedUser = {
        id: auth.user.id,
        role: auth.role,
        assigned_state_ids: auth.assigned_state_ids,
        assigned_group_ids: auth.assigned_group_ids,
      };
      const decision = canPerformMutation(
        mutationUser,
        'notifications.send',
        null,
        { filters: payload.filters ?? undefined } as Record<string, unknown>,
        { resourceType: 'notifications', resourceName: String(payload.title ?? '') }
      );
      logPermissionDecision({
        user_id: auth.user.id,
        role: auth.role,
        action: 'broadcast_send',
        resource_type: 'notifications',
        allowed: decision.ok,
        denied_reason: decision.ok ? null : decision.reason,
      });
      if (!decision.ok) return json({ error: decision.reason }, 403);
    }

    const integrity = resolveBroadcastEventIdForIntegrity(payload);
    if (!integrity.ok) {
      return json({ error: integrity.error }, 400);
    }

    const result = await runBroadcast(admin, expo, payload);
    if (!result.ok) {
      const clientErr =
        result.error === BROADCAST_EVENT_CAMPAIGN_REQUIRES_EVENT_MSG ||
        /required|please select an event|invalid event_id|title and body are required/i.test(result.error);
      const status = clientErr ? 400 : 500;
      return json(
        {
          error: result.error,
          ...(result.broadcast_id ? { broadcast_id: result.broadcast_id } : {}),
          ...(result.detail ? { detail: result.detail } : {}),
        },
        status
      );
    }

    const broadcastId =
      result.ok && 'broadcast_id' in result && result.broadcast_id ? String(result.broadcast_id) : null;
    const cmGroupIds = payload.filters?.group_ids;
    const scopeGroupIds =
      auth.role === 'campaign_manager' && Array.isArray(cmGroupIds)
        ? cmGroupIds.map((x) => String(x))
        : [];
    void logAdminAction({
      actor_user_id: auth.user.id,
      actor_role: auth.role,
      action_type: 'notifications.send',
      resource_type: 'notifications',
      resource_id: broadcastId,
      resource_name: payload?.title ?? null,
      previous_data: null,
      new_data: { broadcast_id: broadcastId, payload },
      severity: 'info',
      undoable: false,
      scope_state_ids: auth.role === 'moderator' ? auth.assigned_state_ids : [],
      scope_group_ids: scopeGroupIds,
    });

    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
}
