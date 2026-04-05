import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example).'
  );
}

if (/localhost|127\.0\.0\.1/i.test(supabaseUrl)) {
  throw new Error('Invalid Supabase URL: use hosted https://*.supabase.co URL, not localhost.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
export { supabaseUrl };

/** Remove persisted Supabase session keys (sb-*-auth-token, etc.) if anything was left behind. */
async function clearSupabaseAuthStorageKeys(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter(
      (k) => k.startsWith('sb-') && (k.includes('auth-token') || k.includes('auth.') || k.endsWith('-code-verifier'))
    );
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Logout: clear local auth only — Supabase `signOut`, Google native sign-out, sweep stray `sb-*` keys.
 * Does **not** delete or update `profiles` (DB language/party stay for the next login).
 * Use this everywhere instead of only navigating to /login.
 */
export async function signOutApp(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    /* still try to clear local storage / Google */
  }

  if (Platform.OS !== 'web') {
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      await GoogleSignin.signOut();
    } catch {
      /* not signed in with Google or module unavailable */
    }
  }

  await clearSupabaseAuthStorageKeys();
}
