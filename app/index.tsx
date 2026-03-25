import { Colors } from '../constants/Colors';
import { supabase } from '../lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const SESSION_RESOLVE_TIMEOUT_MS = 3000;
const MIN_SPLASH_MS = 1500;

/**
 * Entry: Supabase session check → logged in → dashboard; else → login (Google + Supabase on login screen).
 */
export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const start = Date.now();

      const sessionResult = await Promise.race([
        supabase.auth.getSession(),
        new Promise<Awaited<ReturnType<typeof supabase.auth.getSession>>>((resolve) =>
          setTimeout(
            () => resolve({ data: { session: null }, error: null }),
            SESSION_RESOLVE_TIMEOUT_MS
          )
        ),
      ]);

      const elapsed = Date.now() - start;
      if (elapsed < MIN_SPLASH_MS) {
        await new Promise<void>((r) => setTimeout(r, MIN_SPLASH_MS - elapsed));
      }

      if (cancelled) return;

      const session = sessionResult.data?.session;
      if (__DEV__) console.log('Current Session:', session);

      if (!session?.user) {
        router.replace('/login');
        return;
      }

      router.replace('/(tabs)/dashboard');
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.sub}>Loading…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  sub: {
    marginTop: 16,
    fontSize: 15,
    color: Colors.textMuted,
    fontFamily: Colors.fontFamily,
  },
});
