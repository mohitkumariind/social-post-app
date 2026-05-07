import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';
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

/**
 * If the user opened a push whose `data` includes `broadcast_id`, inserts `public.notification_open`
 * (unique per user + broadcast → admin `opened_count` via trigger).
 */
export async function recordBroadcastOpenFromNotificationResponse(
  response: Notifications.NotificationResponse
): Promise<void> {
  const data = response.notification?.request?.content?.data;
  if (!data || typeof data !== 'object') return;
  const raw = (data as Record<string, unknown>).broadcast_id;
  const broadcastId =
    typeof raw === 'string' && raw.trim().length > 0
      ? raw.trim()
      : typeof raw === 'number' && Number.isFinite(raw)
        ? String(raw)
        : null;
  if (!broadcastId) return;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.id) return;

  const { error } = await supabase.from('notification_open').insert({
    broadcast_id: broadcastId,
    user_id: user.id,
  });

  if (error) {
    if (error.code === '23505') return;
    if (__DEV__) console.warn('[notifications] notification_open insert:', error.message);
  }
}
