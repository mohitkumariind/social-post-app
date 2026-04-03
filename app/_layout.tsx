import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, LogBox, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider } from '../context/LanguageContext';
import { UserProvider, useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';
import { cleanupDailyContentCache } from '../lib/mediaCache';
import i18n from '../utils/i18n';

// Keep native splash until we explicitly hide it (prevents white flash).
void SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore: may already be prevented in dev / fast refresh
});

/** Supabase session ↔ `isLoggedIn` (AsyncStorage) on cold start + auth events */
function SessionSync({ children }: { children: React.ReactNode }) {
  const { setIsLoggedIn } = useUser();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const forceLogoutToLogin = async () => {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore: even if signOut throws, local navigation should still recover user flow.
      }
      if (cancelled) return;
      setIsLoggedIn(false);
      router.replace('/login');
    };

    (async () => {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        if (__DEV__) console.warn('[SessionSync] refreshSession failed:', refreshError.message);
        await forceLogoutToLogin();
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (__DEV__) console.warn('[SessionSync] getSession failed:', error.message);
        await forceLogoutToLogin();
        return;
      }
      if (!cancelled) setIsLoggedIn(!!data.session?.user);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setIsLoggedIn(false);
        router.replace('/login');
        return;
      }
      setIsLoggedIn(!!session?.user);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, setIsLoggedIn]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [showCustomLoader, setShowCustomLoader] = useState(true);
  const [dots, setDots] = useState(1);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideNativeSplashOnce = useRef(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    LogBox.ignoreLogs(['Unable to activate keep awake']);
  }, []);

  useEffect(() => {
    // Run cleanup in background while loader is showing.
    void cleanupDailyContentCache();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d >= 5 ? 1 : d + 1));
    }, 260);
    return () => clearInterval(id);
  }, []);

  const dotsText = useMemo(() => '.'.repeat(dots), [dots]);

  useEffect(() => {
    // Fade IN custom loader above native splash; hide native only after opacity reaches 1.
    Animated.timing(opacity, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start(async ({ finished }) => {
      if (finished && !hideNativeSplashOnce.current) {
        hideNativeSplashOnce.current = true;
        await SplashScreen.hideAsync().catch(() => {});
      }
    });

    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 320,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShowCustomLoader(false);
      });
    }, 2000);

    return () => clearTimeout(t);
  }, [opacity]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <LanguageProvider>
            <UserProvider>
              <SessionSync>
                <Stack screenOptions={{ headerShown: false }} />
              </SessionSync>
            </UserProvider>
          </LanguageProvider>
        </I18nextProvider>
      </SafeAreaProvider>

      {showCustomLoader ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.loaderOverlay, { opacity }]}
        >
          <View style={styles.loaderCenter}>
            <Image
              source={require('../assets/images/splash-logo.png')}
              style={styles.loaderLogo}
              resizeMode="contain"
            />
            <Text style={styles.loaderText}>
              Connecting Leaders Connecting People{dotsText}
            </Text>
          </View>

          <View style={[styles.loaderFooter, { bottom: (insets?.bottom ?? 0) + 20 }]}>
            <View style={styles.loaderFooterRow}>
              <Text style={styles.loaderFooterText}>Made with</Text>
              <Text style={styles.loaderFooterText}> ❤️ </Text>
              <Text style={styles.loaderFooterText}>in India</Text>
              <Text style={styles.loaderFooterText}> 🇮🇳</Text>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderCenter: { alignItems: 'center', paddingHorizontal: 24 },
  loaderLogo: {
    width: 140,
    height: 140,
  },
  loaderText: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  loaderFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loaderFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderFooterText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1A1A1A',
  },
});
