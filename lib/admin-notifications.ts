import { createClient } from '@supabase/supabase-js';
import { ANDROID_NOTIFICATION_CHANNEL_ID } from './pushChannel';
import { supabaseUrl } from './supabase';

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo recommends at most 100 messages per request. */
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_SAME_PROJECT_ERR_RE = /All messages must be for the same project/i;

type ExpoPushTicket = {
  status?: string;
  message?: string;
  id?: string;
};

type ExpoPushResponse = {
  data?: ExpoPushTicket[];
  errors?: unknown;
};

type ExpoPushTicketError = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Sends a push to every distinct device token in `public.push_tokens`.
 *
 * **Security:** Uses `SUPABASE_SERVICE_ROLE_KEY` so all rows can be read. Run only on a trusted
 * server (script, Edge Function, admin backend). Never put the service role key in the mobile app bundle.
 */
export async function sendGlobalNotification(
  title: string,
  body: string,
  data?: any
): Promise<void> {
  const serviceKey =
    typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined;
  if (!serviceKey?.trim()) {
    throw new Error(
      'sendGlobalNotification: set SUPABASE_SERVICE_ROLE_KEY in the environment (server-side only).'
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await admin.from('push_tokens').select('token, project_id');
  if (error) {
    throw new Error(`sendGlobalNotification: failed to load push_tokens — ${error.message}`);
  }

  const tokensByProject = new Map<string, string[]>();
  for (const r of rows ?? []) {
    const row = r as { token: string | null; project_id?: string | null };
    const tok = typeof row.token === 'string' ? row.token : '';
    if (!tok) continue;
    const pid = typeof row.project_id === 'string' ? row.project_id.trim() : '';
    const key = pid ? pid : '__unknown__';
    const arr = tokensByProject.get(key) ?? [];
    arr.push(tok);
    tokensByProject.set(key, arr);
  }

  if (tokensByProject.size === 0) {
    return;
  }

  const payloadBase = {
    title,
    body,
    sound: 'default' as const,
    priority: 'high' as const,
    channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
    ...(data !== undefined ? { data } : {}),
  };

  for (const [projectKey, toks] of tokensByProject.entries()) {
    const groupLabel = projectKey === '__unknown__' ? 'unknown' : projectKey.slice(0, 8) + '…';
    console.log('[push] projectGroup', { project: groupLabel, tokens: toks.length });

    const messages = toks.map((to) => ({ ...payloadBase, to }));
    const step = projectKey === '__unknown__' ? 1 : EXPO_PUSH_CHUNK_SIZE;

    for (let i = 0; i < messages.length; i += step) {
      const chunk = messages.slice(i, i + step);

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
      let json: ExpoPushResponse | null = null;
      try {
        json = JSON.parse(rawText) as ExpoPushResponse;
      } catch {
        /* handled below */
      }

      const shouldDelete = (text: string) =>
        /DeviceNotRegistered/i.test(text) ||
        EXPO_SAME_PROJECT_ERR_RE.test(text) ||
        (/project/i.test(text) && /mismatch|different|same request|same project/i.test(text));

      if (!res.ok) {
        // Mixed-project tokens can make the whole chunk fail; retry individually and remove bad tokens.
        if (EXPO_SAME_PROJECT_ERR_RE.test(rawText)) {
          for (const msg of chunk) {
            const r = await fetch(EXPO_PUSH_SEND_URL, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify([msg]),
            });
            const t = await r.text();
            if (!r.ok) {
              if (shouldDelete(t)) {
                console.log('[push] invalidToken', { token: String((msg as any).to ?? '').slice(0, 12) + '…' });
                await admin.from('push_tokens').delete().eq('token', String((msg as any).to ?? ''));
              }
              continue;
            }
            let parsed: ExpoPushResponse | null = null;
            try {
              parsed = JSON.parse(t) as ExpoPushResponse;
            } catch {
              parsed = null;
            }
            const tickets = parsed?.data as ExpoPushTicketError[] | undefined;
            if (Array.isArray(tickets)) {
              const first = tickets[0];
              if (first?.status === 'error') {
                const err = String((first as any)?.details?.error ?? '');
                const msgText = String(first?.message ?? '');
                if (err === 'DeviceNotRegistered' || shouldDelete(msgText)) {
                  console.log('[push] invalidToken', { token: String((msg as any).to ?? '').slice(0, 12) + '…' });
                  await admin.from('push_tokens').delete().eq('token', String((msg as any).to ?? ''));
                }
              }
            }
          }
          continue;
        }
        throw new Error(
          `sendGlobalNotification: Expo push HTTP ${res.status} — ${rawText.slice(0, 500)}`
        );
      }

      const tickets = json?.data;
      if (Array.isArray(tickets)) {
        const failures = tickets.filter((t) => t?.status === 'error');
        // Drop bad tokens so the system self-heals.
        for (let idx = 0; idx < tickets.length; idx++) {
          const t = tickets[idx] as any;
          if (String(t?.status ?? '').toLowerCase() !== 'error') continue;
          const err = String(t?.details?.error ?? '');
          const msgText = String(t?.message ?? '');
          if (err === 'DeviceNotRegistered' || shouldDelete(msgText)) {
            const tok = String((chunk[idx] as any)?.to ?? '');
            if (tok) {
              console.log('[push] deletedToken', { token: tok.slice(0, 12) + '…' });
              await admin.from('push_tokens').delete().eq('token', tok);
            }
          }
        }
        if (failures.length > 0 && __DEV__) {
          console.warn(
            '[sendGlobalNotification] Some tickets failed:',
            failures.map((f) => f.message ?? f).slice(0, 5)
          );
        }
      }
    }
  }
}
