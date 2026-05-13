import { useFonts } from 'expo-font';
import * as ExpoLinking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, LogBox, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider } from '../context/LanguageContext';
import { UserProvider, useUser } from '../context/UserContext';
import { cleanupDailyContentCache } from '../lib/mediaCache';
import { FRAME_FONT_ASSETS } from '../lib/frameFonts';
import { extractAssignmentIdFromDeepLink, getTwitterCampaignAssignmentIdFromPayload } from '../lib/twitterCampaignDeepLink';
import { navigateToTwitterCampaign } from '../lib/twitterCampaignNavigation';
import { isTwitterCampaignAssignmentUuid, trackTwitterCampaignEvent } from '../lib/twitterCampaignAnalytics';
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  recordNotificationOpen,
  registerForPushNotificationsAsync,
  saveTokenToSupabase,
} from '../lib/notifications';
import { signOutApp, supabase } from '../lib/supabase';
import i18n from '../utils/i18n';

// Keep native splash until we explicitly hide it (prevents white flash).
void SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore: may already be prevented in dev / fast refresh
});

/** True when refresh failed because the stored refresh token is invalid (not network blips). */
function isRefreshTokenFatalError(err: { message?: string; status?: number } | null): boolean {
  if (!err?.message) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes('invalid refresh token') ||
    m.includes('refresh token not found') ||
    m.includes('already used')
  );
}

/** Supabase session ↔ `isLoggedIn` (AsyncStorage) on cold start + auth events */
function SessionSync({ children }: { children: React.ReactNode }) {
  const { setIsLoggedIn } = useUser();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const forceLogoutToLogin = async () => {
      try {
        await signOutApp();
      } catch {
        // Ignore: even if signOut throws, local navigation should still recover user flow.
      }
      if (cancelled) return;
      setIsLoggedIn(false);
      router.replace('/login');
    };

    (async () => {
      // Restore session from AsyncStorage first. Do NOT refresh-before-getSession: a failed
      // refresh (offline / slow network) would previously call signOut and wipe a valid session.
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error) {
        if (__DEV__) console.warn('[SessionSync] getSession failed:', error.message);
        setIsLoggedIn(false);
        return;
      }
      if (data.session?.user) {
        setIsLoggedIn(true);
        void supabase.auth.refreshSession().then(({ error: refErr }) => {
          if (cancelled || !refErr) return;
          if (__DEV__) console.warn('[SessionSync] background refreshSession:', refErr.message);
          if (isRefreshTokenFatalError(refErr)) void forceLogoutToLogin();
        });
        return;
      }
      setIsLoggedIn(false);
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

const BANNER_GREEN = '#25D366';

/** Registers Expo push token when logged in; foreground in-app banner for incoming notifications. */
function PushNotificationLayer() {
  const router = useRouter();
  const { isLoggedIn } = useUser();
  const insets = useSafeAreaInsets();
  const [banner, setBanner] = useState<{ title: string; body: string; data?: Record<string, unknown> | null } | null>(
    null
  );
  const bannerClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: false,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }, []);

  /** Save Expo token whenever session exists — not only via `isLoggedIn` (avoids race after OAuth). */
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;

    const registerAndSave = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session?.user) return;
      const token = await registerForPushNotificationsAsync();
      if (cancelled || !token) return;
      await saveTokenToSupabase(token);
    };

    void registerAndSave();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session?.user) return;
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        void (async () => {
          const token = await registerForPushNotificationsAsync();
          if (cancelled || !token) return;
          await saveTokenToSupabase(token);
        })();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body, data } = notification.request.content;
      const safeTitle = typeof title === 'string' ? title.trim() : title != null ? String(title).trim() : '';
      const safeBody = typeof body === 'string' ? body.trim() : body != null ? String(body).trim() : '';
      if (!safeTitle && !safeBody) {
        setBanner(null);
        return;
      }
      const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
      setBanner({ title: safeTitle, body: safeBody, data: dataObj });
      if (bannerClearRef.current) clearTimeout(bannerClearRef.current);
      bannerClearRef.current = setTimeout(() => setBanner(null), 4500);
    });
    return () => {
      sub.remove();
      if (bannerClearRef.current) clearTimeout(bannerClearRef.current);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void (async () => {
        await recordNotificationOpen(response);
        const aid = getTwitterCampaignAssignmentIdFromPayload(response.notification.request.content.data);
        if (aid) navigateToTwitterCampaign(router, aid);
      })();
    });
    return () => sub.remove();
  }, [isLoggedIn, router]);

  useEffect(() => {
    if (!isLoggedIn) return;
    void (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last) return;
      await recordNotificationOpen(last);
      const aid = getTwitterCampaignAssignmentIdFromPayload(last.notification.request.content.data);
      if (aid) navigateToTwitterCampaign(router, aid);
    })();
  }, [isLoggedIn, router]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const openFromUrl = (url: string | null) => {
      const id = extractAssignmentIdFromDeepLink(url ?? '');
      if (id) navigateToTwitterCampaign(router, id);
    };
    void ExpoLinking.getInitialURL().then(openFromUrl);
    const sub = ExpoLinking.addEventListener('url', ({ url }) => openFromUrl(url));
    return () => sub.remove();
  }, [isLoggedIn, router]);

  const shouldRenderBanner = isLoggedIn && !!banner && (!!banner.title || !!banner.body);
  if (!shouldRenderBanner) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        onPress={() => {
          const aid = getTwitterCampaignAssignmentIdFromPayload(banner.data);
          if (aid && isTwitterCampaignAssignmentUuid(aid)) {
            void trackTwitterCampaignEvent(aid, 'notification_opened', { surface: 'foreground_banner' });
          }
          if (aid) navigateToTwitterCampaign(router, aid);
          if (bannerClearRef.current) clearTimeout(bannerClearRef.current);
          setBanner(null);
        }}
        style={[pushStyles.bannerOuter, { paddingTop: Math.max(insets.top, 8) + 8 }]}
      >
        <View style={pushStyles.bannerInner}>
          {banner.title ? <Text style={pushStyles.bannerTitle}>{banner.title}</Text> : null}
          {banner.body ? (
            <Text style={pushStyles.bannerBody} numberOfLines={3}>
              {banner.body}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const pushStyles = StyleSheet.create({
  bannerOuter: {
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  bannerInner: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: BANNER_GREEN,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  bannerBody: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    opacity: 0.95,
  },
});

type RootErrorBoundaryState = { hasError: boolean };

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Keep logs production-safe but include stack when available.
    const payload =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { error: String(error) };
    if (__DEV__) console.warn('[RootErrorBoundary] render crash captured', payload);
    console.error(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.rootFallback}>
          <Text style={styles.rootFallbackTitle}>Something went wrong</Text>
          <Text style={styles.rootFallbackSub}>Please restart the app.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function RootLayoutBody() {
  const [showCustomLoader, setShowCustomLoader] = useState(true);
  const [dots, setDots] = useState(1);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideNativeSplashOnce = useRef(false);
  const insets = useSafeAreaInsets();
  const updateCheckInFlightRef = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        if (__DEV__) {
          console.log('[updates] runtimeVersion=', Updates.runtimeVersion);
          console.log('[updates] channel=', (Updates as any).channel ?? 'unknown');
          console.log('[updates] updateId=', Updates.updateId ?? null);
          console.log('[updates] isEmbeddedLaunch=', Updates.isEmbeddedLaunch);
          console.log('[updates] isEmergencyLaunch=', Updates.isEmergencyLaunch);
        }

        // NOTE: checkForUpdateAsync is not re-entrant; calling it while a previous check/fetch is running
        // can be rejected by the native module. Use the same in-flight lock as the debug button.
        if (updateCheckInFlightRef.current) return;
        updateCheckInFlightRef.current = true;

        let result: Updates.UpdateCheckResult | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = await Updates.checkForUpdateAsync();
            break;
          } catch (err) {
            lastErr = err;
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 1200));
            }
          }
        }
        if (!result) {
          if (__DEV__) console.warn('[updates] checkForUpdateAsync failed after retries', lastErr);
          return;
        }
        if (result.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();
          // Apply immediately after a successful fetch (no need to wait for next launch).
          const isNew = typeof (fetched as any)?.isNew === 'boolean' ? (fetched as any).isNew : true;
          if (isNew) await Updates.reloadAsync();
        }
      } catch (e) {
        if (__DEV__) console.warn('[updates] error', e);
      } finally {
        updateCheckInFlightRef.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    LogBox.ignoreLogs(['Unable to activate keep awake']);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      sound: 'default',
      showBadge: true,
    });
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
      <RootErrorBoundary>
        <SafeAreaProvider>
          <I18nextProvider i18n={i18n}>
            <LanguageProvider>
              <UserProvider>
                <SessionSync>
                  <View style={{ flex: 1 }}>
                    <Stack screenOptions={{ headerShown: false }} />
                    <PushNotificationLayer />
                  </View>
                </SessionSync>
              </UserProvider>
            </LanguageProvider>
          </I18nextProvider>
        </SafeAreaProvider>
      </RootErrorBoundary>

      {showCustomLoader ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.loaderOverlay, { opacity }]}
        >
          <View style={styles.loaderCenter}>
            <Image
              source={require('../assets/images/icon.png')}
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

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FRAME_FONT_ASSETS);
  const fontsReady = fontsLoaded || fontError != null;

  useEffect(() => {
    if (fontError && __DEV__) console.warn('[fonts] Frame font load error:', fontError);
  }, [fontError]);

  if (!fontsReady) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
      </GestureHandlerRootView>
    );
  }

  return <RootLayoutBody />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  rootFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  rootFallbackTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  rootFallbackSub: {
    marginTop: 8,
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
  },
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
