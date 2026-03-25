import { Stack, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider } from '../context/LanguageContext';
import { UserProvider, useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';
import i18n from '../utils/i18n';

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
  useEffect(() => {
    // expo-video / keep-awake runtime issue in some dev-client builds; avoid noisy unhandled rejection overlay.
    LogBox.ignoreLogs(['Unable to activate keep awake']);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
    </GestureHandlerRootView>
  );
}
