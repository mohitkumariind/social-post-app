import type { SupabaseClient } from '@supabase/supabase-js';
import Expo, { type ExpoPushMessage } from 'expo-server-sdk';
import { ANDROID_NOTIFICATION_CHANNEL_ID } from '../../lib/pushChannel';
import { filterRetryRecipientIds } from '@/lib/workers/notification-retry';

const HISTORY_INSERT_CHUNK = 500;
const EXPO_SAME_PROJECT_ERR_RE = /All messages must be for the same project/i;

export type BroadcastFilters = {
  party?: string | null;
  state?: string | null;
  loksabha_id?: number | null;
  assembly_id?: number | null;
  assigned_state_ids?: number[] | null;
  group_ids?: number[] | null;
};

export type BroadcastFilterLabels = {
  party?: string | null;
  state?: string | null;
  loksabha?: string | null;
  assembly?: string | null;
};

export type BroadcastPayload = {
  preview_only?: boolean;
  title?: string;
  body?: string;
  image_url?: string | null;
  data?: Record<string, unknown>;
  all_workers?: boolean;
  filters?: BroadcastFilters;
  filter_labels?: BroadcastFilterLabels;
  /**
   * When set, send only to these profile (auth user) ids after server-side RBAC filtering.
   * Skips geographic `filters` expansion (still subject to `/api/notifications/send` scope checks).
   */
  target_user_ids?: string[] | null;
  /** Optional `public.events.id` stored on `notification_broadcasts` for campaign analytics. */
  event_id?: string | null;
};

/** Optional campaign/event linkage (validated UUID or null). */
function optionalEventIdFromPayload(payload: BroadcastPayload): string | null {
  const raw = payload.event_id;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length === 0) return null;
  const EVENT_ID_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return EVENT_ID_UUID_RE.test(s) ? s : null;
}

export type BroadcastRunOptions = {
  /**
   * Reuse an existing broadcast row (worker retry idempotency).
   * When set, runBroadcast will not create/delete notification_broadcasts rows.
   */
  existing_broadcast_id?: string | null;
  /**
   * Skip notifications_history inserts (used when history already exists for a reused broadcast).
   */
  skip_history_insert?: boolean;
  /**
   * Deterministic identity for scheduled notification workers.
   * Prevents duplicate broadcast rows for the same scheduled job.
   */
  scheduled_notification_id?: string | null;
  /**
   * On retry, send only recipients still pending/retryable.
   */
  resume_pending_only?: boolean;
};

export async function fetchFilteredProfileIds(
  admin: SupabaseClient,
  allWorkers: boolean,
  f: BroadcastFilters
): Promise<string[]> {
  if (allWorkers) {
    const { data, error } = await admin.from('profiles').select('id');
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r: { id: string }) => String(r.id))
      .filter((id) => id.length > 0);
  }

  let q = admin.from('profiles').select('id');
  const party = typeof f.party === 'string' ? f.party.trim() : '';
  const state = typeof f.state === 'string' ? f.state.trim() : '';
  if (party) q = q.eq('party', party);
  if (state) q = q.eq('state', state);
  if (Array.isArray(f.assigned_state_ids) && f.assigned_state_ids.length > 0) {
    // Canonical subset semantics: profile states must be contained in the allowed state set.
    q = q.not('assigned_state_ids', 'is', null).neq('assigned_state_ids', '{}').containedBy('assigned_state_ids', f.assigned_state_ids);
  }
  if (Array.isArray(f.group_ids) && f.group_ids.length > 0) {
    q = q.in('group_id', f.group_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)));
  }
  if (f.loksabha_id != null && !Number.isNaN(Number(f.loksabha_id))) {
    q = q.eq('loksabha_id', Number(f.loksabha_id));
  }
  if (f.assembly_id != null && !Number.isNaN(Number(f.assembly_id))) {
    q = q.eq('assembly_id', Number(f.assembly_id));
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r: { id: string }) => String(r.id))
    .filter((id) => id.length > 0);
}

export async function fetchTokensForUsers(
  admin: SupabaseClient,
  userIds: string[]
): Promise<{ user_id: string; token: string; project_id: string | null; platform: string | null }[]> {
  if (userIds.length === 0) return [];
  const out: { user_id: string; token: string; project_id: string | null; platform: string | null }[] = [];
  const batch = 200;
  for (let i = 0; i < userIds.length; i += batch) {
    const slice = userIds.slice(i, i + batch);
    const { data, error } = await admin
      .from('push_tokens')
      .select('user_id, token, project_id, platform')
      .in('user_id', slice);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const row = r as {
        user_id: string | null;
        token: string | null;
        project_id?: string | null;
        platform?: string | null;
      };
      const uid = row.user_id != null ? String(row.user_id) : '';
      const tok = typeof row.token === 'string' ? row.token : '';
      if (uid && tok) out.push({ user_id: uid, token: tok, project_id: row.project_id ?? null, platform: row.platform ?? null });
    }
  }
  return out;
}

export type BroadcastResult =
  | {
      ok: true;
      preview: true;
      profile_count: number;
      token_count: number;
      worker_count: number;
    }
  | {
      ok: true;
      preview?: false;
      broadcast_id: string;
      target_user_count: number;
      sent_count: number;
      delivered_count: number;
      failed_count: number;
    }
  | { ok: false; error: string; broadcast_id?: string; detail?: string };

export async function runBroadcast(
  admin: SupabaseClient,
  expo: Expo,
  payload: BroadcastPayload,
  options: BroadcastRunOptions = {}
): Promise<BroadcastResult> {
  const allWorkers = payload.all_workers !== false;
  const filters: BroadcastFilters = {
    party: payload.filters?.party ?? null,
    state: payload.filters?.state ?? null,
    loksabha_id:
      payload.filters?.loksabha_id != null ? Number(payload.filters.loksabha_id) : null,
    assembly_id:
      payload.filters?.assembly_id != null ? Number(payload.filters.assembly_id) : null,
    assigned_state_ids:
      Array.isArray((payload.filters as any)?.assigned_state_ids)
        ? (payload.filters as any).assigned_state_ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
        : null,
    group_ids:
      Array.isArray((payload.filters as any)?.group_ids)
        ? (payload.filters as any).group_ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
        : null,
  };

  const explicitTargets = Array.isArray((payload as { target_user_ids?: unknown }).target_user_ids)
    ? [...new Set(((payload as { target_user_ids?: unknown }).target_user_ids as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean))]
    : [];

  const baseProfileIds =
    explicitTargets.length > 0
      ? explicitTargets
      : await fetchFilteredProfileIds(admin, allWorkers, filters);

  if (payload.preview_only === true) {
    const previewTokenRows = await fetchTokensForUsers(admin, baseProfileIds);
    const previewUnique = new Set(
      previewTokenRows.map((r) => String(r.token ?? '').trim()).filter((t) => t && Expo.isExpoPushToken(t))
    );
    return {
      ok: true,
      preview: true,
      profile_count: baseProfileIds.length,
      token_count: previewUnique.size,
      worker_count: baseProfileIds.length,
    };
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!title || !body) {
    return { ok: false, error: 'title and body are required' };
  }

  const imageUrl =
    typeof payload.image_url === 'string' && payload.image_url.trim().length > 0
      ? payload.image_url.trim()
      : null;

  const filtersStored = {
    all_workers: explicitTargets.length > 0 ? false : allWorkers,
    party: filters.party,
    state: filters.state,
    loksabha_id: filters.loksabha_id,
    assembly_id: filters.assembly_id,
    assigned_state_ids: filters.assigned_state_ids,
    group_ids: filters.group_ids,
    labels: payload.filter_labels ?? {},
    recipient_mode: explicitTargets.length > 0 ? 'explicit_user_ids' : 'filters',
    explicit_recipient_count: explicitTargets.length > 0 ? explicitTargets.length : null,
  };

  const eventIdForBroadcast = optionalEventIdFromPayload(payload);

  const existingBroadcastId = String(options.existing_broadcast_id ?? '').trim();
  const scheduledNotificationId = String(options.scheduled_notification_id ?? '').trim();
  let broadcastId = existingBroadcastId;
  if (!broadcastId) {
    let bcInsert = await admin
      .from('notification_broadcasts')
      .insert({
        title,
        body,
        image_url: imageUrl,
        filters: filtersStored,
        event_id: eventIdForBroadcast,
        target_user_count: baseProfileIds.length,
        sent_count: 0,
        delivered_count: 0,
        failed_count: 0,
        opened_count: 0,
        scheduled_notification_id: scheduledNotificationId || null,
      })
      .select('id')
      .single();
    if (bcInsert.error && String(bcInsert.error.message ?? '').toLowerCase().includes('scheduled_notification_id')) {
      bcInsert = await admin
        .from('notification_broadcasts')
        .insert({
          title,
          body,
          image_url: imageUrl,
          filters: filtersStored,
          event_id: eventIdForBroadcast,
          target_user_count: baseProfileIds.length,
          sent_count: 0,
          delivered_count: 0,
          failed_count: 0,
          opened_count: 0,
        })
        .select('id')
        .single();
    }
    const bcIns = bcInsert.data;
    const bcErr = bcInsert.error;

    if (bcErr || !bcIns?.id) {
      const dup =
        String((bcErr as any)?.code ?? '') === '23505' ||
        /duplicate key/i.test(String(bcErr?.message ?? ''));
      if (dup && scheduledNotificationId) {
        const reused = await admin
          .from('notification_broadcasts')
          .select('id')
          .eq('scheduled_notification_id', scheduledNotificationId)
          .maybeSingle();
        if (!reused.error && reused.data?.id) {
          broadcastId = String(reused.data.id);
          console.info('[worker.broadcast.reused]', JSON.stringify({
            scheduled_notification_id: scheduledNotificationId,
            broadcast_id: broadcastId,
          }));
        }
      }
    }
    if (!broadcastId && (bcErr || !bcIns?.id)) {
      return {
        ok: false,
        error:
          bcErr?.message ??
          'Failed to create notification_broadcasts row (run migration 20260405140000_notification_broadcast_center.sql?)',
      };
    }
    if (!broadcastId && bcIns?.id) broadcastId = String(bcIns.id);
  }

  let profileIds = baseProfileIds;
  if (options.resume_pending_only && broadcastId) {
    const pendingRes = await admin
      .from('notifications_history')
      .select('user_id')
      .eq('broadcast_id', broadcastId)
      .in('delivery_status', ['pending', 'failed_retryable']);
    if (!pendingRes.error) {
      profileIds = filterRetryRecipientIds(
        profileIds,
        (pendingRes.data ?? []) as Array<{ user_id: string | null }>
      );
      console.info('[worker.retry.resumed]', JSON.stringify({
        broadcast_id: broadcastId,
        pending_recipients: profileIds.length,
      }));
    }
  }

  const tokenRows = await fetchTokensForUsers(admin, profileIds);
  const tokenToUser = new Map<string, string>();
  const tokenToProject = new Map<string, string | null>();
  for (const row of tokenRows) {
    if (!tokenToUser.has(row.token)) {
      tokenToUser.set(row.token, row.user_id);
      tokenToProject.set(row.token, row.project_id ?? null);
    }
  }
  const uniqueTokens = [...tokenToUser.keys()].filter((t) => Expo.isExpoPushToken(t));

  const tokensByProject = new Map<string, string[]>();
  for (const tok of uniqueTokens) {
    const pid = tokenToProject.get(tok) ?? null;
    const key = pid && pid.trim().length > 0 ? pid.trim() : '__unknown__';
    const arr = tokensByProject.get(key) ?? [];
    arr.push(tok);
    tokensByProject.set(key, arr);
  }

  if (!options.skip_history_insert && profileIds.length > 0) {
    const historyRows = profileIds.map((user_id) => ({
      user_id,
      title,
      body,
      image_url: imageUrl,
      is_read: false,
      broadcast_id: broadcastId,
      delivery_status: 'pending',
    }));

    for (let i = 0; i < historyRows.length; i += HISTORY_INSERT_CHUNK) {
      const chunk = historyRows.slice(i, i + HISTORY_INSERT_CHUNK);
      let { error: histErr } = await admin.from('notifications_history').insert(chunk);
      if (histErr && String(histErr.message ?? '').toLowerCase().includes('delivery_status')) {
        const fallbackChunk = chunk.map(({ delivery_status: _delivery_status, ...rest }) => rest);
        const fallback = await admin.from('notifications_history').insert(fallbackChunk);
        histErr = fallback.error ?? null;
      }
      if (histErr) {
        if (!existingBroadcastId) {
          await admin.from('notification_broadcasts').delete().eq('id', broadcastId);
        }
        return { ok: false, error: `notifications_history: ${histErr.message}`, broadcast_id: broadcastId };
      }
    }
  }

  const dataPayload: Record<string, unknown> = {
    ...(payload.data ?? {}),
    broadcast_id: broadcastId,
  };
  if (imageUrl) {
    // Common keys used by client-side push handlers / image renderers.
    dataPayload.image = imageUrl;
    dataPayload.url = imageUrl;
    // Back-compat with older payload consumers.
    dataPayload.image_url = imageUrl;
  }

  const messages: ExpoPushMessage[] = uniqueTokens.map((to) => {
    const msg: ExpoPushMessage = {
      to,
      title,
      body,
      sound: 'default',
      priority: 'high',
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      // Required by iOS rich notifications; harmless on Android.
      mutableContent: true,
      data: dataPayload,
    };
    if (imageUrl) {
      msg.richContent = { image: imageUrl };
    }
    return msg;
  });

  let deliveredTotal = 0;
  let failedTotal = 0;
  let sentAttemptedTotal = 0;

  async function removeBadToken(token: string) {
    const t = String(token ?? '').trim();
    if (!t) return;
    try {
      const { error } = await admin.from('push_tokens').delete().eq('token', t);
      if (error) console.warn('[push] deletedToken failed:', error.message);
      else console.log('[push] deletedToken', { token: t.slice(0, 12) + '…' });
    } catch (e) {
      console.warn('[push] deletedToken exception:', e);
    }
  }

  function shouldDeleteToken(detailsError: string, message: string): boolean {
    const e = String(detailsError ?? '');
    const m = String(message ?? '');
    if (e === 'DeviceNotRegistered' || /DeviceNotRegistered/i.test(m)) return true;
    // Only delete for explicit project ownership mismatch; never for network/5xx/timeouts.
    if (EXPO_SAME_PROJECT_ERR_RE.test(m)) return true;
    if (/project/i.test(m) && /mismatch|different|same request|same project/i.test(m)) return true;
    return false;
  }

  async function markDeliveryStatus(
    userIds: string[],
    status: 'sent' | 'failed_retryable' | 'failed_permanent',
    errorMessage?: string
  ) {
    const ids = Array.from(new Set(userIds.map((x) => String(x).trim()).filter(Boolean)));
    if (ids.length === 0) return;
    const patch = {
      delivery_status: status,
      delivery_last_attempt_at: new Date().toISOString(),
      delivery_error: errorMessage ?? null,
    };
    const res = await admin
      .from('notifications_history')
      .update(patch)
      .eq('broadcast_id', broadcastId)
      .in('user_id', ids);
    if (res.error && String(res.error.message ?? '').toLowerCase().includes('delivery_status')) {
      // Backward compatibility for older schemas without delivery columns.
      return;
    }
    if (res.error) {
      console.warn('[worker.delivery.status.update.failed]', JSON.stringify({ status, count: ids.length, error: res.error.message }));
    }
  }

  async function sendChunkWithIsolation(chunk: ExpoPushMessage[]) {
    // Sends individually so mixed-project tokens cannot poison the whole batch.
    for (const msg of chunk) {
      sentAttemptedTotal += 1;
      const userId = String(tokenToUser.get(String(msg.to ?? '')) ?? '').trim();
      try {
        const tickets = await expo.sendPushNotificationsAsync([msg]);
        const t = tickets?.[0];
        if (!t) continue;
        if (t.status === 'ok') {
          deliveredTotal += 1;
          if (userId) await markDeliveryStatus([userId], 'sent');
          continue;
        }
        failedTotal += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const details = (t as any)?.details as { error?: string } | undefined;
        const err = String(details?.error ?? '');
        const message = String((t as any)?.message ?? '');
        console.error(`[push] invalidToken (isolated): ${message}${err ? ` (${err})` : ''}`);
        if (userId) {
          await markDeliveryStatus(
            [userId],
            shouldDeleteToken(err, message) ? 'failed_permanent' : 'failed_retryable',
            message || err || 'expo-ticket-error'
          );
        }
        if (shouldDeleteToken(err, message)) {
          await removeBadToken(String(msg.to ?? ''));
        }
      } catch (e) {
        failedTotal += 1;
        const em = e instanceof Error ? e.message : String(e);
        console.error('[push] send threw (isolated):', em);
        if (userId) await markDeliveryStatus([userId], 'failed_retryable', em);
        if (shouldDeleteToken('', em)) {
          await removeBadToken(String(msg.to ?? ''));
        }
      }
    }
  }

  // Prevent mixed-project requests: group by stored Expo project id.
  for (const [projectKey, toks] of tokensByProject.entries()) {
    const groupLabel = projectKey === '__unknown__' ? 'unknown' : projectKey.slice(0, 8) + '…';
    console.log('[push] projectGroup', { project: groupLabel, tokens: toks.length });

    const groupMessages: ExpoPushMessage[] = toks.map((to) => {
      const msg: ExpoPushMessage = {
        to,
        title,
        body,
        sound: 'default',
        priority: 'high',
        channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
        mutableContent: true,
        data: dataPayload,
      };
      if (imageUrl) msg.richContent = { image: imageUrl };
      return msg;
    });

    // Tokens without project_id are from older installs: send isolated to avoid poisoning.
    if (projectKey === '__unknown__') {
      await sendChunkWithIsolation(groupMessages);
      continue;
    }

    const chunks = expo.chunkPushNotifications(groupMessages);
    for (const chunk of chunks) {
      sentAttemptedTotal += chunk.length;
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        const sentUsers: string[] = [];
        const failedRetryableUsers: string[] = [];
        const failedPermanentUsers: string[] = [];
        for (let i = 0; i < tickets.length; i++) {
          const t = tickets[i];
          const tok = String(chunk[i]?.to ?? '');
          const uid = String(tokenToUser.get(tok) ?? '').trim();
          if (t.status === 'ok') {
            deliveredTotal += 1;
            if (uid) sentUsers.push(uid);
            continue;
          }
          failedTotal += 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const details = (t as any)?.details as { error?: string } | undefined;
          const err = String(details?.error ?? '');
          const message = String((t as any)?.message ?? '');
          console.error(`[push] invalidToken: ${message}${err ? ` (${err})` : ''}`);
          if (uid) {
            if (shouldDeleteToken(err, message)) failedPermanentUsers.push(uid);
            else failedRetryableUsers.push(uid);
          }
          if (shouldDeleteToken(err, message)) await removeBadToken(tok);
        }
        await markDeliveryStatus(sentUsers, 'sent');
        await markDeliveryStatus(failedRetryableUsers, 'failed_retryable', 'expo-ticket-retryable');
        await markDeliveryStatus(failedPermanentUsers, 'failed_permanent', 'expo-ticket-permanent');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[push] send threw:', msg);
        // Belt-and-suspenders: isolate only on explicit same-project error.
        if (EXPO_SAME_PROJECT_ERR_RE.test(msg)) {
          console.warn('[push] same-project error after grouping; isolating chunk');
          await sendChunkWithIsolation(chunk);
          continue;
        }
        const chunkUsers = chunk
          .map((m) => String(tokenToUser.get(String(m.to ?? '')) ?? '').trim())
          .filter(Boolean);
        await markDeliveryStatus(chunkUsers, 'failed_retryable', msg);
        await admin
          .from('notification_broadcasts')
          .update({
            sent_count: sentAttemptedTotal,
            failed_count: failedTotal + chunk.length,
          })
          .eq('id', broadcastId);
        return { ok: false, error: `Expo push failed: ${msg}`, broadcast_id: broadcastId };
      }
    }
  }

  await admin
    .from('notification_broadcasts')
    .update({
      sent_count: sentAttemptedTotal,
      delivered_count: deliveredTotal,
      failed_count: failedTotal,
    })
    .eq('id', broadcastId);

  return {
    ok: true,
    broadcast_id: broadcastId,
    target_user_count: profileIds.length,
    sent_count: sentAttemptedTotal,
    delivered_count: deliveredTotal,
    failed_count: failedTotal,
  };
}
