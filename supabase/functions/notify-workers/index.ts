import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
const HISTORY_INSERT_CHUNK = 500;
const EXPO_SAME_PROJECT_ERR_RE = /All messages must be for the same project/i;

/** Must match `ANDROID_NOTIFICATION_CHANNEL_ID` in repo `lib/pushChannel.ts`. */
const ANDROID_NOTIFICATION_CHANNEL_ID = 'default';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LEGACY_NOTIFY_ENABLED = (Deno.env.get('ENABLE_LEGACY_NOTIFY_WORKERS') ?? '').trim().toLowerCase() === 'true';
const LEGACY_NOTIFY_SECRET = (Deno.env.get('LEGACY_NOTIFY_WORKERS_SECRET') ?? '').trim();

type Filters = {
  party?: string | null;
  state?: string | null;
  loksabha_id?: number | null;
  assembly_id?: number | null;
};

type FilterLabels = {
  party?: string | null;
  state?: string | null;
  loksabha?: string | null;
  assembly?: string | null;
};

type RequestBody = {
  preview_only?: boolean;
  title?: string;
  body?: string;
  image_url?: string | null;
  data?: Record<string, unknown>;
  all_workers?: boolean;
  filters?: Filters;
  filter_labels?: FilterLabels;
  /** Optional `public.events.id` for `notification_broadcasts.event_id`. */
  event_id?: string | null;
};

function parseOptionalEventId(body: RequestBody): string | null {
  const raw = body.event_id;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return re.test(s) ? s : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchFilteredProfileIds(
  admin: SupabaseClient,
  allWorkers: boolean,
  f: Filters
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

async function fetchTokensForUsers(
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

function parseExpoTicketCounts(rawText: string): { ok: number; err: number } {
  let ok = 0;
  let err = 0;
  try {
    const parsed = JSON.parse(rawText) as { data?: { status?: string }[] };
    const tickets = parsed.data;
    if (!Array.isArray(tickets)) return { ok: 0, err: 0 };
    for (const t of tickets) {
      const st = typeof t?.status === 'string' ? t.status.toLowerCase() : '';
      if (st === 'ok') ok += 1;
      else err += 1;
    }
  } catch {
    /* ignore */
  }
  return { ok, err };
}

function parseExpoTicketErrors(rawText: string): { idx: number; error: string; message: string }[] {
  try {
    const parsed = JSON.parse(rawText) as { data?: any[] };
    const tickets = parsed?.data;
    if (!Array.isArray(tickets)) return [];
    const out: { idx: number; error: string; message: string }[] = [];
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      if (!t || String(t.status ?? '').toLowerCase() !== 'error') continue;
      const detailsErr = String(t?.details?.error ?? '');
      const msg = String(t?.message ?? '');
      out.push({ idx: i, error: detailsErr, message: msg });
    }
    return out;
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!LEGACY_NOTIFY_ENABLED) {
      return json(
        {
          error: 'Deprecated endpoint',
          code: 'LEGACY_NOTIFY_DISABLED',
          message: 'Use /api/notifications/send or /api/admin/notifications/schedule instead.',
        },
        410
      );
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceKey?.trim() || !supabaseUrl?.trim()) {
      return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    if (!LEGACY_NOTIFY_SECRET) {
      return json({ error: 'LEGACY_NOTIFY_WORKERS_SECRET not configured' }, 503);
    }
    const reqSecret = req.headers.get('x-legacy-notify-secret')?.trim() ?? '';
    if (!reqSecret || reqSecret !== LEGACY_NOTIFY_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const payload = (await req.json()) as RequestBody;

    const allWorkers = payload.all_workers !== false;

    const filters: Filters = {
      party: payload.filters?.party ?? null,
      state: payload.filters?.state ?? null,
      loksabha_id:
        payload.filters?.loksabha_id != null ? Number(payload.filters.loksabha_id) : null,
      assembly_id:
        payload.filters?.assembly_id != null ? Number(payload.filters.assembly_id) : null,
    };

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
    const uniqueTokens = [...tokenToUser.keys()];

    if (payload.preview_only === true) {
      return json({
        ok: true,
        preview: true,
        profile_count: profileIds.length,
        token_count: uniqueTokens.length,
        worker_count: profileIds.length,
      });
    }

    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!title || !body) {
      return json({ error: 'title and body are required' }, 400);
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

    const eventIdForBroadcast = parseOptionalEventId(payload);

    const { data: bcIns, error: bcErr } = await admin
      .from('notification_broadcasts')
      .insert({
        title,
        body,
        image_url: imageUrl,
        filters: filtersStored,
        event_id: eventIdForBroadcast,
        target_user_count: profileIds.length,
        sent_count: 0,
        delivered_count: 0,
        failed_count: 0,
        opened_count: 0,
      })
      .select('id')
      .single();

    if (bcErr || !bcIns?.id) {
      return json(
        {
          error:
            bcErr?.message ??
            'Failed to create notification_broadcasts row (run migration 20260405140000_notification_broadcast_center.sql?)',
        },
        500
      );
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
          return json({ error: `notifications_history: ${histErr.message}` }, 500);
        }
      }
    }

    let deliveredTotal = 0;
    let failedTotal = 0;
    let sentAttemptedTotal = 0;
    const dataPayload: Record<string, unknown> = {
      ...(payload.data ?? {}),
      broadcast_id: broadcastId,
    };
    if (imageUrl) dataPayload.image_url = imageUrl;

    const messageBase: Record<string, unknown> = {
      title,
      body,
      sound: 'default',
      priority: 'high',
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      data: dataPayload,
    };

    if (imageUrl) {
      messageBase.mutableContent = true;
      /** Expo Push API: rich notification image (Android / supported clients). */
      messageBase.image = imageUrl;
    }

    const tokensByProject = new Map<string, string[]>();
    for (const tok of uniqueTokens) {
      const pid = tokenToProject.get(tok) ?? null;
      const key = pid && pid.trim().length > 0 ? pid.trim() : '__unknown__';
      const arr = tokensByProject.get(key) ?? [];
      arr.push(tok);
      tokensByProject.set(key, arr);
    }

    const messagesByProject = new Map<string, any[]>();
    for (const [pid, toks] of tokensByProject.entries()) {
      const msgs = toks.map((to) => ({ ...messageBase, to }));
      messagesByProject.set(pid, msgs);
    }

    function shouldDeleteTokenFromResponse(text: string): boolean {
      if (/DeviceNotRegistered/i.test(text)) return true;
      if (EXPO_SAME_PROJECT_ERR_RE.test(text)) return true;
      if (/project/i.test(text) && /mismatch|different|same request|same project/i.test(text)) return true;
      return false;
    }

    for (const [projectKey, messages] of messagesByProject.entries()) {
      const groupLabel = projectKey === '__unknown__' ? 'unknown' : projectKey.slice(0, 8) + '…';
      console.log('[push] projectGroup', { project: groupLabel, tokens: messages.length });

      if (messages.length === 0) continue;

      // Unknown project tokens are sent individually to avoid poisoning.
      const forceIsolated = projectKey === '__unknown__';
      const step = forceIsolated ? 1 : EXPO_PUSH_CHUNK_SIZE;

      for (let i = 0; i < messages.length; i += step) {
        const chunk = messages.slice(i, i + step);
        sentAttemptedTotal += chunk.length;
        const res = await fetch(EXPO_PUSH_SEND_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
        const rawText = await res.text();
        if (!res.ok) {
          // Mixed-project tokens can cause a full-request failure. Retry individually so we can
          // remove bad tokens without failing the whole broadcast.
          if (EXPO_SAME_PROJECT_ERR_RE.test(rawText)) {
            console.warn('[expo] Mixed-project tokens detected; retrying chunk with isolation');
            for (const msg of chunk) {
              const singleRes = await fetch(EXPO_PUSH_SEND_URL, {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  'Accept-Encoding': 'gzip, deflate',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify([msg]),
              });
              const singleText = await singleRes.text();
              if (!singleRes.ok) {
                if (shouldDeleteTokenFromResponse(singleText)) {
                  try {
                    console.log('[push] invalidToken', { token: String((msg as any).to ?? '').slice(0, 12) + '…' });
                    await admin.from('push_tokens').delete().eq('token', String((msg as any).to ?? ''));
                  } catch {
                    // ignore
                  }
                }
                failedTotal += 1;
                continue;
              }
              const { ok, err } = parseExpoTicketCounts(singleText);
              deliveredTotal += ok;
              failedTotal += err;
              const errs = parseExpoTicketErrors(singleText);
              for (const e of errs) {
                if (e.error === 'DeviceNotRegistered' || /DeviceNotRegistered/i.test(e.message)) {
                  try {
                    console.log('[push] invalidToken', { token: String((msg as any).to ?? '').slice(0, 12) + '…' });
                    await admin.from('push_tokens').delete().eq('token', String((msg as any).to ?? ''));
                  } catch {
                    // ignore
                  }
                }
              }
            }
            continue;
          }
          await admin
            .from('notification_broadcasts')
            .update({ sent_count: sentAttemptedTotal, failed_count: failedTotal + chunk.length })
            .eq('id', broadcastId);
          return json(
            { error: `Expo push HTTP ${res.status}`, detail: rawText.slice(0, 500), broadcast_id: broadcastId },
            502
          );
        }
        const { ok, err } = parseExpoTicketCounts(rawText);
        deliveredTotal += ok;
        failedTotal += err;

        // Remove DeviceNotRegistered tokens (prevents repeated failures).
        const errs = parseExpoTicketErrors(rawText);
        for (const e of errs) {
          if (e.error !== 'DeviceNotRegistered' && !/DeviceNotRegistered/i.test(e.message)) continue;
          const tok = String((chunk[e.idx] as any)?.to ?? '');
          if (!tok) continue;
          try {
            console.log('[push] invalidToken', { token: tok.slice(0, 12) + '…' });
            await admin.from('push_tokens').delete().eq('token', tok);
          } catch {
            // ignore
          }
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

    return json({
      ok: true,
      broadcast_id: broadcastId,
      target_user_count: profileIds.length,
      sent_count: sentAttemptedTotal,
      delivered_count: deliveredTotal,
      failed_count: failedTotal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
