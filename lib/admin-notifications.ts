import { createClient } from '@supabase/supabase-js';
import { ANDROID_NOTIFICATION_CHANNEL_ID } from './pushChannel';
import { supabaseUrl } from './supabase';

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo recommends at most 100 messages per request. */
const EXPO_PUSH_CHUNK_SIZE = 100;

type ExpoPushTicket = {
  status?: string;
  message?: string;
  id?: string;
};

type ExpoPushResponse = {
  data?: ExpoPushTicket[];
  errors?: unknown;
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

  const { data: rows, error } = await admin.from('push_tokens').select('token');
  if (error) {
    throw new Error(`sendGlobalNotification: failed to load push_tokens — ${error.message}`);
  }

  const tokens = [
    ...new Set(
      (rows ?? [])
        .map((r) => (r as { token: string | null }).token)
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
    ),
  ];

  if (tokens.length === 0) {
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

  const messages = tokens.map((to) => ({
    ...payloadBase,
    to,
  }));

  for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + EXPO_PUSH_CHUNK_SIZE);

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

    if (!res.ok) {
      throw new Error(
        `sendGlobalNotification: Expo push HTTP ${res.status} — ${rawText.slice(0, 500)}`
      );
    }

    const tickets = json?.data;
    if (Array.isArray(tickets)) {
      const failures = tickets.filter((t) => t?.status === 'error');
      if (failures.length > 0 && __DEV__) {
        console.warn(
          '[sendGlobalNotification] Some tickets failed:',
          failures.map((f) => f.message ?? f).slice(0, 5)
        );
      }
    }
  }
}
