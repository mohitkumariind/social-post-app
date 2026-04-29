import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, LogBox, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider } from '../context/LanguageContext';
import { UserProvider, useUser } from '../context/UserContext';
import { cleanupDailyContentCache } from '../lib/mediaCache';
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  recordBroadcastOpenFromNotificationResponse,
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
  const { isLoggedIn } = useUser();
  const insets = useSafeAreaInsets();
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);
  const bannerClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }, []);

  /** Save Expo token whenever session exists — not only via `isLoggedIn` (avoids race after OAuth). */
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body } = notification.request.content;
      setBanner({
        title: typeof title === 'string' ? title : title != null ? String(title) : '',
        body: typeof body === 'string' ? body : body != null ? String(body) : '',
      });
      if (bannerClearRef.current) clearTimeout(bannerClearRef.current);
      bannerClearRef.current = setTimeout(() => setBanner(null), 4500);
    });
    return () => {
      sub.remove();
      if (bannerClearRef.current) clearTimeout(bannerClearRef.current);
    };
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void recordBroadcastOpenFromNotificationResponse(response);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    void (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last) await recordBroadcastOpenFromNotificationResponse(last);
    })();
  }, [isLoggedIn]);

  if (!banner) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        onPress={() => {
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

export default function RootLayout() {
  const [showCustomLoader, setShowCustomLoader] = useState(true);
  const [dots, setDots] = useState(1);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideNativeSplashOnce = useRef(false);
  const insets = useSafeAreaInsets();
  const [otaLabel, setOtaLabel] = useState<string>('OTA: checking…');

  useEffect(() => {
    // OTA audit logs (shows if the installed build is checking the right channel and why updates may not apply).
    // These logs are safe in production and do not change UI.
    void (async () => {
      try {
        if (__DEV__) {
          console.log('[updates] channel:', Updates.channel);
          console.log('[updates] runtimeVersion:', Updates.runtimeVersion);
          console.log('[updates] updateId:', Updates.updateId);
          console.log('[updates] isEmbeddedLaunch:', Updates.isEmbeddedLaunch);
        }
        const result = await Updates.checkForUpdateAsync();
        if (__DEV__) console.log('[updates] checkForUpdateAsync:', result);
        if (result.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();
          if (__DEV__) console.log('[updates] fetchUpdateAsync:', fetched);
          // Apply immediately on next tick.
          await Updates.reloadAsync();
        }
      } catch (e) {
        if (__DEV__) console.warn('[updates] error', e);
      }
    })();
  }, []);

  useEffect(() => {
    const id = String((Updates as any)?.updateId ?? '').trim();
    if (!id) setOtaLabel('Running Embedded Binary');
    else setOtaLabel(`Running OTA Update: ${id}`);
  }, []);

  const onCheckForUpdates = async () => {
    try {
      const meta = {
        isEnabled: (Updates as any).isEnabled,
        channel: (Updates as any).channel,
        runtimeVersion: (Updates as any).runtimeVersion,
        updateId: (Updates as any).updateId,
        isEmbeddedLaunch: (Updates as any).isEmbeddedLaunch,
      };
      const res = await Updates.checkForUpdateAsync();
      Alert.alert('Updates.checkForUpdateAsync', JSON.stringify({ meta, res }));
    } catch (e) {
      const errPayload =
        e instanceof Error
          ? { name: e.name, message: e.message, stack: e.stack }
          : typeof e === 'object' && e != null
            ? e
            : { message: String(e ?? '') };
      const meta = {
        isEnabled: (Updates as any).isEnabled,
        channel: (Updates as any).channel,
        runtimeVersion: (Updates as any).runtimeVersion,
        updateId: (Updates as any).updateId,
        isEmbeddedLaunch: (Updates as any).isEmbeddedLaunch,
      };
      Alert.alert('Updates error', JSON.stringify({ meta, error: errPayload }));
    }
  };

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
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <LanguageProvider>
            <UserProvider>
              <SessionSync>
                <View style={{ flex: 1 }}>
                  <Stack screenOptions={{ headerShown: false }} />
                  <PushNotificationLayer />
                  <View style={styles.otaDebugWrap} pointerEvents="box-none">
                    <Pressable style={styles.otaDebugCard} onPress={() => void onCheckForUpdates()}>
                      <Text style={styles.otaDebugText} numberOfLines={2}>
                        {otaLabel}
                      </Text>
                      <Text style={styles.otaDebugHint} numberOfLines={1}>
                        Tap to check for updates
                      </Text>
                    </Pressable>
                  </View>
                </View>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  otaDebugWrap: {
    position: 'absolute',
    left: 10,
    bottom: 110,
    zIndex: 99999,
    elevation: 99999,
  },
  otaDebugCard: {
    maxWidth: 320,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  otaDebugText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  otaDebugHint: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
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
