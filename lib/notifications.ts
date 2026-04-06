import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/** EAS project id from app.json → `expo.extra.eas.projectId`. */
export function getExpoProjectId(): string | undefined {
  const id = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Requests notification permission and returns the Expo push token, or `null` if unavailable.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  if (!Device.isDevice) {
    if (__DEV__) console.warn('[notifications] Expo push token requires a physical device');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    if (__DEV__) console.warn('[notifications] Notification permission not granted');
    return null;
  }

  const projectId = getExpoProjectId();
  if (!projectId) {
    if (__DEV__) console.warn('[notifications] Missing expo.extra.eas.projectId (app.json)');
    return null;
  }

  try {
    const push = await Notifications.getExpoPushTokenAsync({ projectId });
    return push.data;
  } catch (e) {
    if (__DEV__) console.warn('[notifications] getExpoPushTokenAsync failed:', e);
    return null;
  }
}

/**
 * Upserts the push token for `auth.uid()` into `public.push_tokens`.
 * Retries when the session is not ready yet (common right after Google login).
 */
export async function saveTokenToSupabase(token: string): Promise<boolean> {
  const delaysMs = [0, 250, 500, 800, 1200, 2000];
  const parts = [Device.modelName, Device.deviceName].filter(
    (x): x is string => typeof x === 'string' && x.length > 0
  );
  const deviceName = parts.length > 0 ? parts.join(' · ') : null;

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
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' }
    );

    if (!error) {
      return true;
    }

    console.warn('[notifications] push_tokens upsert failed:', error.message, error.code ?? '');
    return false;
  }

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
