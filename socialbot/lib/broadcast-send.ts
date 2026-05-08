import type { SupabaseClient } from '@supabase/supabase-js';
import Expo, { type ExpoPushMessage } from 'expo-server-sdk';
import { ANDROID_NOTIFICATION_CHANNEL_ID } from '../../lib/pushChannel';

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
    q = q.overlaps('assigned_state_ids', f.assigned_state_ids);
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
  payload: BroadcastPayload
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

  const profileIds = await fetchFilteredProfileIds(admin, allWorkers, filters);
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

  if (payload.preview_only === true) {
    return {
      ok: true,
      preview: true,
      profile_count: profileIds.length,
      token_count: uniqueTokens.length,
      worker_count: profileIds.length,
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
    all_workers: allWorkers,
    party: filters.party,
    state: filters.state,
    loksabha_id: filters.loksabha_id,
    assembly_id: filters.assembly_id,
    assigned_state_ids: filters.assigned_state_ids,
    group_ids: filters.group_ids,
    labels: payload.filter_labels ?? {},
  };

  const { data: bcIns, error: bcErr } = await admin
    .from('notification_broadcasts')
    .insert({
      title,
      body,
      image_url: imageUrl,
      filters: filtersStored,
      target_user_count: profileIds.length,
      sent_count: 0,
      delivered_count: 0,
      failed_count: 0,
      opened_count: 0,
    })
    .select('id')
    .single();

  if (bcErr || !bcIns?.id) {
    return {
      ok: false,
      error:
        bcErr?.message ??
        'Failed to create notification_broadcasts row (run migration 20260405140000_notification_broadcast_center.sql?)',
    };
  }

  const broadcastId = String(bcIns.id);

  if (profileIds.length > 0) {
    const historyRows = profileIds.map((user_id) => ({
      user_id,
      title,
      body,
      image_url: imageUrl,
      is_read: false,
      broadcast_id: broadcastId,
    }));

    for (let i = 0; i < historyRows.length; i += HISTORY_INSERT_CHUNK) {
      const chunk = historyRows.slice(i, i + HISTORY_INSERT_CHUNK);
      const { error: histErr } = await admin.from('notifications_history').insert(chunk);
      if (histErr) {
        await admin.from('notification_broadcasts').delete().eq('id', broadcastId);
        return { ok: false, error: `notifications_history: ${histErr.message}` };
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

  async function sendChunkWithIsolation(chunk: ExpoPushMessage[]) {
    // Sends individually so mixed-project tokens cannot poison the whole batch.
    for (const msg of chunk) {
      try {
        const tickets = await expo.sendPushNotificationsAsync([msg]);
        const t = tickets?.[0];
        if (!t) continue;
        if (t.status === 'ok') {
          deliveredTotal += 1;
          continue;
        }
        failedTotal += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const details = (t as any)?.details as { error?: string } | undefined;
        const err = String(details?.error ?? '');
        const message = String((t as any)?.message ?? '');
        console.error(`[push] invalidToken (isolated): ${message}${err ? ` (${err})` : ''}`);
        if (shouldDeleteToken(err, message)) {
          await removeBadToken(String(msg.to ?? ''));
        }
      } catch (e) {
        failedTotal += 1;
        const em = e instanceof Error ? e.message : String(e);
        console.error('[push] send threw (isolated):', em);
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
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const t = tickets[i];
          if (t.status === 'ok') {
            deliveredTotal += 1;
            continue;
          }
          failedTotal += 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const details = (t as any)?.details as { error?: string } | undefined;
          const err = String(details?.error ?? '');
          const message = String((t as any)?.message ?? '');
          console.error(`[push] invalidToken: ${message}${err ? ` (${err})` : ''}`);
          const tok = String(chunk[i]?.to ?? '');
          if (shouldDeleteToken(err, message)) await removeBadToken(tok);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[push] send threw:', msg);
        // Belt-and-suspenders: isolate only on explicit same-project error.
        if (EXPO_SAME_PROJECT_ERR_RE.test(msg)) {
          console.warn('[push] same-project error after grouping; isolating chunk');
          await sendChunkWithIsolation(chunk);
          continue;
        }
        await admin
          .from('notification_broadcasts')
          .update({
            sent_count: messages.length,
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
      sent_count: messages.length,
      delivered_count: deliveredTotal,
      failed_count: failedTotal,
    })
    .eq('id', broadcastId);

  return {
    ok: true,
    broadcast_id: broadcastId,
    target_user_count: profileIds.length,
    sent_count: messages.length,
    delivered_count: deliveredTotal,
    failed_count: failedTotal,
  };
}
