import type { SupabaseClient } from '@supabase/supabase-js';
import Expo, { type ExpoPushMessage } from 'expo-server-sdk';

const HISTORY_INSERT_CHUNK = 500;

export type BroadcastFilters = {
  party?: string | null;
  state?: string | null;
  loksabha_id?: number | null;
  assembly_id?: number | null;
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
): Promise<{ user_id: string; token: string }[]> {
  if (userIds.length === 0) return [];
  const out: { user_id: string; token: string }[] = [];
  const batch = 200;
  for (let i = 0; i < userIds.length; i += batch) {
    const slice = userIds.slice(i, i + batch);
    const { data, error } = await admin.from('push_tokens').select('user_id, token').in('user_id', slice);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const row = r as { user_id: string | null; token: string | null };
      const uid = row.user_id != null ? String(row.user_id) : '';
      const tok = typeof row.token === 'string' ? row.token : '';
      if (uid && tok) out.push({ user_id: uid, token: tok });
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
  };

  const profileIds = await fetchFilteredProfileIds(admin, allWorkers, filters);
  const tokenRows = await fetchTokensForUsers(admin, profileIds);
  const tokenToUser = new Map<string, string>();
  for (const row of tokenRows) {
    if (!tokenToUser.has(row.token)) tokenToUser.set(row.token, row.user_id);
  }
  const uniqueTokens = [...tokenToUser.keys()].filter((t) => Expo.isExpoPushToken(t));

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
  if (imageUrl) dataPayload.image_url = imageUrl;

  const messages: ExpoPushMessage[] = uniqueTokens.map((to) => {
    const msg: ExpoPushMessage = {
      to,
      title,
      body,
      sound: 'default',
      data: dataPayload,
    };
    if (imageUrl) {
      msg.mutableContent = true;
      msg.richContent = { image: imageUrl };
    }
    return msg;
  });

  let deliveredTotal = 0;
  let failedTotal = 0;

  if (messages.length > 0) {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (const t of tickets) {
          if (t.status === 'ok') deliveredTotal += 1;
          else failedTotal += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
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
