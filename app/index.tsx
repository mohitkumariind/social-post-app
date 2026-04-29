import { Colors } from '../constants/Colors';
import { supabase } from '../lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const MIN_SPLASH_MS = 1500;
const GET_SESSION_RETRIES = 5;
const GET_SESSION_RETRY_DELAY_MS = 120;

async function getSessionWithHydrationRetries(): Promise<
  Awaited<ReturnType<typeof supabase.auth.getSession>>
> {
  let last: Awaited<ReturnType<typeof supabase.auth.getSession>> | null = null;
  for (let i = 0; i < GET_SESSION_RETRIES; i++) {
    try {
      last = await supabase.auth.getSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown getSession error');
      last = {
        data: { session: null },
        error: { message } as { message: string },
      } as Awaited<ReturnType<typeof supabase.auth.getSession>>;
    }
    if (last.data?.session?.user || last.error) return last;
    if (i < GET_SESSION_RETRIES - 1) {
      await new Promise<void>((r) => setTimeout(r, GET_SESSION_RETRY_DELAY_MS));
    }
  }
  return last ?? { data: { session: null }, error: null };
}

/**
 * Entry: Supabase session check → logged in → dashboard; else → login (Google Sign-In + Supabase).
 */
export default function Index() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const start = Date.now();
      try {
        // Do not race getSession with a timeout that treats "slow" as "logged out" — AsyncStorage
        // hydration can exceed a few seconds on cold start.
        const sessionResult = await getSessionWithHydrationRetries();

        const elapsed = Date.now() - start;
        if (elapsed < MIN_SPLASH_MS) {
          await new Promise<void>((r) => setTimeout(r, MIN_SPLASH_MS - elapsed));
        }

        if (cancelled) return;

        const session = sessionResult.data?.session;

        if (!session?.user) {
          router.replace('/login');
          return;
        }

        router.replace('/(tabs)/dashboard');
      } catch (error) {
        if (__DEV__) console.warn('[Index] startup init failed:', error);
        if (cancelled) return;
        router.replace('/login');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.sub}>Loading…</Text>
      </View>

      <View style={[styles.footer, { marginBottom: (insets?.bottom ?? 0) + 20 }]}>
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Made with</Text>
          <Text style={styles.footerText}> ❤️ </Text>
          <Text style={styles.footerText}>in India</Text>
          <Text style={styles.footerText}> 🇮🇳</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  center: { justifyContent: 'center', alignItems: 'center' },
  sub: {
    marginTop: 16,
    fontSize: 15,
    color: Colors.textMuted,
    fontFamily: Colors.fontFamily,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  footerText: { fontSize: 16, fontWeight: '800', color: '#1A1A1A' },
});
