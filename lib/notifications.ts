import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';
import { PUSH_DATA_TYPE_TWITTER_CAMPAIGN } from './twitterCampaignDeepLink';
import { supabase } from './supabase';

export { ANDROID_NOTIFICATION_CHANNEL_ID } from './pushChannel';

/**
 * Intentionally no hardcoded fallback.
 * After `eas init`, `expo.extra.eas.projectId` is the source of truth.
 */
const FALLBACK_EAS_PROJECT_ID = '';

function readProjectIdFromExtra(extra: unknown): string | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const eas = (extra as Record<string, unknown>).eas as Record<string, unknown> | undefined;
  const id = eas?.projectId;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined;
}

/** Resolves EAS project id for Expo Push (release builds sometimes omit `expoConfig`). */
export function getExpoProjectId(): string {
  const fromExpoConfig = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExpoConfig === 'string' && fromExpoConfig.trim().length > 0) {
    return fromExpoConfig.trim();
  }

  const m2 = Constants.manifest2 as Record<string, unknown> | null | undefined;
  if (m2?.extra && typeof m2.extra === 'object') {
    const ex = m2.extra as Record<string, unknown>;
    const fromDirect = readProjectIdFromExtra(ex);
    if (fromDirect) return fromDirect;
    const expoClient = ex.expoClient as Record<string, unknown> | undefined;
    if (expoClient?.extra) {
      const fromClient = readProjectIdFromExtra(expoClient.extra);
      if (fromClient) return fromClient;
    }
  }

  const m1 = Constants.manifest as Record<string, unknown> | null | undefined;
  if (m1?.extra) {
    const fromM1 = readProjectIdFromExtra(m1.extra);
    if (fromM1) return fromM1;
  }

  if (__DEV__) console.warn('[notifications] Missing expo.extra.eas.projectId (run eas init / eas build at least once)');
  return FALLBACK_EAS_PROJECT_ID;
}

/** Register for push + upsert token (call after login when session is definitely set). */
export async function ensurePushTokenRegisteredAndSaved(): Promise<void> {
  const token = await registerForPushNotificationsAsync();
  if (token) await saveTokenToSupabase(token);
}

let didShowNotificationPermissionAlert = false;

/**
 * Requests notification permission and returns the Expo push token, or `null` if unavailable.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  if (!Device.isDevice) {
    if (__DEV__) {
      console.warn(
        '[notifications] Device.isDevice is false (emulator/simulator?). Expo push often needs a real device; still attempting token…'
      );
    }
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    if (__DEV__) console.warn('[notifications] Notification permission not granted:', finalStatus);
    if (!didShowNotificationPermissionAlert) {
      didShowNotificationPermissionAlert = true;
      Alert.alert(
        'Notifications permission',
        'Notifications are disabled. Enable permission to receive updates.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => {
              void Linking.openSettings().catch(() => undefined);
            },
          },
        ]
      );
    }
    return null;
  }

  const projectId = getExpoProjectId();

  const delays = [0, 800, 2000];
  for (const ms of delays) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    try {
      const push = await Notifications.getExpoPushTokenAsync({ projectId });
      if (push?.data && typeof push.data === 'string' && push.data.length > 0) {
        return push.data;
      }
    } catch (e) {
      if (__DEV__) console.warn('[notifications] getExpoPushTokenAsync attempt failed:', e);
    }
  }

  return null;
}

/**
 * Upserts the push token for `auth.uid()` into `public.push_tokens`.
 * One row per user (unique `user_id`): a new device token replaces the previous token.
 * Retries when the session is not ready yet (common right after Google login).
 */
export async function saveTokenToSupabase(token: string): Promise<boolean> {
  const delaysMs = [0, 250, 500, 800, 1200, 2000];
  const parts = [Device.modelName, Device.deviceName].filter(
    (x): x is string => typeof x === 'string' && x.length > 0
  );
  const deviceName = parts.length > 0 ? parts.join(' · ') : null;
  const projectId = getExpoProjectId();
  const platform = Platform.OS;

  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i] > 0) {
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      continue;
    }

    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: user.id,
        token,
        device_name: deviceName,
        project_id: projectId || null,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (!error) {
      return true;
    }

    // If the DB hasn't applied the "one token per user" migration yet, `onConflict: 'user_id'`
    // can fail with Postgres 42P10 (no matching unique constraint). Fall back to the older
    // composite unique index (user_id, token).
    const code = (error as any)?.code ?? null;
    if (code === '42P10') {
      const { error: fallbackErr } = await supabase.from('push_tokens').upsert(
        {
          user_id: user.id,
          token,
          device_name: deviceName,
          project_id: projectId || null,
          platform,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' }
      );
      if (!fallbackErr) {
        console.warn('[notifications] push_tokens upsert fallback succeeded (onConflict user_id,token)', { userId: user.id });
        return true;
      }
      console.warn('[notifications] push_tokens upsert fallback failed', {
        message: fallbackErr.message,
        code: (fallbackErr as any)?.code ?? null,
        details: (fallbackErr as any)?.details ?? null,
        hint: (fallbackErr as any)?.hint ?? null,
        userId: user.id,
      });
      return false;
    }

    // Log in all environments so RLS/constraints are visible in production logs.
    console.warn('[notifications] push_tokens upsert failed', {
      message: error.message,
      code,
      details: (error as any)?.details ?? null,
      hint: (error as any)?.hint ?? null,
      userId: user.id,
    });
    return false;
  }

  // Log in all environments so auth/session issues are visible in production logs.
  console.warn('[notifications] saveTokenToSupabase: no session after retries');
  return false;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuidDataField(data: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return null;
  const raw = data[key];
  if (raw == null) return null;
  const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (!s) return null;
  return UUID_RE.test(s) ? s : null;
}

function parseBroadcastId(data: Record<string, unknown>): string | null {
  const raw = data.broadcast_id;
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Records a push open in `public.notification_open` (bumps broadcast `opened_count` via trigger).
 * Call from **notification response** handlers (tap / cold start) only when `data` is present.
 *
 * - **broadcast_id** (required): from push `data`.
 * - **notification_id**: `notifications_history.id` when present in `data` (no client-side guess).
 * - **event_id**: only if the key exists in `data` and the value is a valid UUID — never inferred from other fields.
 */
export async function recordNotificationOpen(response: Notifications.NotificationResponse): Promise<void> {
  const data = response.notification?.request?.content?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const rec = data as Record<string, unknown>;

  if (rec.type === PUSH_DATA_TYPE_TWITTER_CAMPAIGN) {
    const assignmentId = parseUuidDataField(rec, 'assignment_id') ?? parseUuidDataField(rec, 'assignmentId');
    if (assignmentId) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (!userError && user?.id) {
        const { error } = await supabase.rpc('twitter_campaign_track_event', {
          p_assignment_id: assignmentId,
          p_event_type: 'notification_opened',
          p_metadata: {},
        });
        if (error && __DEV__) console.warn('[notifications] twitter_campaign_track_event:', error.message);
      }
      return;
    }
  }

  const broadcastId = parseBroadcastId(rec);
  if (!broadcastId) return;

  const notificationId = parseUuidDataField(rec, 'notification_id');
  const eventId = parseUuidDataField(rec, 'event_id');

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.id) return;

  const row: {
    broadcast_id: string;
    user_id: string;
    notifications_history_id?: string;
    event_id?: string;
  } = {
    broadcast_id: broadcastId,
    user_id: user.id,
  };
  if (notificationId) row.notifications_history_id = notificationId;
  if (eventId) row.event_id = eventId;

  const { error } = await supabase.from('notification_open').insert(row);

  if (error) {
    if (error.code === '23505') return;
    if (__DEV__) console.warn('[notifications] notification_open insert:', error.message);
  }
}

/** @deprecated Use {@link recordNotificationOpen} (same behavior). */
export const recordBroadcastOpenFromNotificationResponse = recordNotificationOpen;
