import { Inter_400Regular, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { FontDisplay } from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect } from 'react';
import { Platform, View } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider } from '../context/LanguageContext';
import { UserProvider, useUser } from '../context/UserContext';
import i18n from '../utils/i18n';

try {
  SplashScreen.preventAutoHideAsync?.();
} catch (_) {}

/** Redirects to /party if user is logged in but hasn't selected party. */
function PartyGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoggedIn, userInfo } = useUser();

  useEffect(() => {
    if (!isLoggedIn || (userInfo?.partyName ?? '').trim()) return;
    const allowed = ['/', '/language', '/(auth)/login', '/party'];
    const isAllowed = allowed.some((p) => pathname === p || pathname?.startsWith(p + '/'));
    if (!isAllowed) {
      router.replace('/party');
    }
  }, [isLoggedIn, userInfo?.partyName, pathname]);

  return <>{children}</>;
}

const iconFonts = {
  ionicons: { uri: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'), display: FontDisplay.SWAP },
  material: { uri: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf'), display: FontDisplay.SWAP },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    ...iconFonts,
    Inter_400Regular,
    Inter_700Bold,
  });

  const onLayoutRootView = useCallback(async () => {
    if (Platform.OS === 'web') {
      await SplashScreen.hideAsync?.();
      return;
    }
    try {
      await SplashScreen.hideAsync?.();
    } catch (e) {
      if (__DEV__) console.warn('SplashScreen.hideAsync failed');
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      SplashScreen.hideAsync?.();
      return;
    }
    if (fontsLoaded) {
      SplashScreen.hideAsync?.();
    } else {
      const t = setTimeout(() => SplashScreen.hideAsync?.(), 100);
      return () => clearTimeout(t);
    }
  }, [fontsLoaded]);

  const shouldRender = Platform.OS === 'web' || fontsLoaded;

  if (!shouldRender) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={() => { onLayoutRootView(); }}>
    <I18nextProvider i18n={i18n}>
      
      <LanguageProvider>
        
        <UserProvider>
          <PartyGuard>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="language" />
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
          </PartyGuard>
        </UserProvider>
      </LanguageProvider>
    </I18nextProvider>
    </View>
  );
}