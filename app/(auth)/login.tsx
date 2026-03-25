import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { supabase } from '../../lib/supabase';
import { getGoogleSignInConfigureParams, getGoogleWebClientId } from '../../src/utils/googleSignInConfig';

type SocialProvider = 'google' | 'facebook' | 'twitter';
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { setIsLoggedIn, setUserInfo } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  /** Which social button is showing the spinner (only that row replaces icon + text). */
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null);

  const handleSocialLogin = useCallback(async () => {
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      setIsLoggedIn(true);
      router.replace('/party');
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  }, [router, setIsLoggedIn]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const webClientId = getGoogleWebClientId();
    if (!webClientId) return;
    GoogleSignin.configure(
      getGoogleSignInConfigureParams(webClientId) as Parameters<typeof GoogleSignin.configure>[0]
    );
  }, []);

  /** Google Sign-In → idToken → Supabase session (persisted via AsyncStorage) → UserContext + /language */
  const handleGoogleLogin = useCallback(async () => {
    if (isLoading) return;

    if (Platform.OS === 'web') {
      Alert.alert(t('save_error_title'), t('login_google_web_only_native'));
      return;
    }

    const webClientId = getGoogleWebClientId();
    if (!webClientId) {
      Alert.alert(t('save_error_title'), t('login_google_missing_config'));
      return;
    }

    setLoadingProvider('google');
    setIsLoading(true);

    try {
      GoogleSignin.configure(getGoogleSignInConfigureParams(webClientId) as Parameters<typeof GoogleSignin.configure>[0]);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      try {
        await GoogleSignin.signOut();
      } catch {
        /* no prior Google session — OK */
      }
      const signInResult = await GoogleSignin.signIn();

      if (signInResult.type === 'cancelled') {
        Alert.alert(t('save_error_title'), t('login_google_cancelled'));
        return;
      }
      if (signInResult.type !== 'success') {
        Alert.alert(t('save_error_title'), t('login_google_error'));
        return;
      }

      let idToken = signInResult.data.idToken;
      if (!idToken) {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken;
      }
      if (!idToken) {
        throw new Error('No ID token from Google Sign-In');
      }

      const { data: authData, error: supaErr } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (supaErr || !authData?.session) {
        if (__DEV__) console.warn('[Login] signInWithIdToken', supaErr ?? 'no session');
        Alert.alert(t('save_error_title'), supaErr?.message ?? 'Could not create session');
        return;
      }

      const gUser = signInResult.data.user;
      const sbUser = authData.session.user;
      const name =
        (sbUser.user_metadata?.full_name as string | undefined) ??
        (sbUser.user_metadata?.name as string | undefined) ??
        gUser.name ??
        '';
      const email = sbUser.email ?? gUser.email ?? '';
      /** Supabase user_metadata (Google OIDC) — fallback to native Google user photo */
      const googlePhotoUrl =
        (sbUser.user_metadata?.avatar_url as string | undefined) ||
        (sbUser.user_metadata?.picture as string | undefined) ||
        gUser.photo ||
        null;
      const photoUrl = googlePhotoUrl;

      const displayName = name.trim();
      const { error: profileError } = await supabase.from('profiles').upsert(
        {
          id: sbUser.id,
          email,
          name: displayName,
          ...(googlePhotoUrl ? { avatar_url: googlePhotoUrl } : {}),
        },
        { onConflict: 'id' }
      );
      if (profileError) console.error('Profile Upsert Error:', profileError);

      setUserInfo((prev) => ({
        ...prev,
        name,
        email,
        avatar_url: photoUrl ?? '',
      }));
      setIsLoggedIn(true);
      router.replace({ pathname: '/language', params: { next: '/party' } });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        Alert.alert(t('save_error_title'), t('login_google_cancelled'));
      } else {
        Alert.alert(t('save_error_title'), err.message || t('login_google_error'));
      }
      if (__DEV__) console.warn('handleGoogleLogin', e);
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  }, [isLoading, router, setIsLoggedIn, setUserInfo, t]);

  /** Facebook OAuth via Supabase + callback session sync + profiles upsert */
  const signInWithFacebook = useCallback(async () => {
    if (isLoading) return;

    setLoadingProvider('facebook');
    setIsLoading(true);

    try {
      const redirectTo = makeRedirectUri({
        scheme: 'socialbot',
        path: 'auth/callback',
      });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'facebook',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error || !data?.url) {
        throw new Error(error?.message || 'Could not start Facebook login');
      }

      const authResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (authResult.type !== 'success') {
        if (authResult.type === 'cancel') {
          Alert.alert(t('save_error_title'), t('login_facebook_cancelled'));
          return;
        }
        throw new Error('Facebook sign-in did not complete.');
      }

      const callbackUrl = authResult.url;
      let sessionReady = false;
      try {
        const u = new URL(callbackUrl);
        const code = u.searchParams.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          sessionReady = true;
        }
      } catch {
        /* continue to hash-token fallback below */
      }

      if (!sessionReady) {
        const hash = callbackUrl.split('#')[1] ?? '';
        const hashParams = new URLSearchParams(hash);
        const access_token = hashParams.get('access_token');
        const refresh_token = hashParams.get('refresh_token');
        if (!access_token || !refresh_token) {
          throw new Error('Missing OAuth tokens in callback.');
        }
        const { error: setSessionError } = await supabase.auth.setSession({ access_token, refresh_token });
        if (setSessionError) throw setSessionError;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      const sbUser = userData?.user;
      if (userError || !sbUser) {
        throw new Error(userError?.message || 'Could not fetch Facebook user');
      }

      const name =
        (sbUser.user_metadata?.full_name as string | undefined) ??
        (sbUser.user_metadata?.name as string | undefined) ??
        '';
      const email = sbUser.email ?? '';
      const photoUrl =
        (sbUser.user_metadata?.avatar_url as string | undefined) ??
        (sbUser.user_metadata?.picture as string | undefined) ??
        null;

      const { error: profileError } = await supabase.from('profiles').upsert(
        {
          id: sbUser.id,
          email,
          name: name.trim(),
          ...(photoUrl ? { avatar_url: photoUrl } : {}),
        },
        { onConflict: 'id' }
      );
      if (profileError) {
        if (__DEV__) console.warn('[Login] Facebook profile upsert failed', profileError);
      }

      setUserInfo((prev) => ({
        ...prev,
        name,
        email,
        avatar_url: photoUrl ?? '',
      }));
      setIsLoggedIn(true);
      router.replace({ pathname: '/language', params: { next: '/party' } });
    } catch (e: unknown) {
      const err = e as { message?: string };
      Alert.alert(t('save_error_title'), err.message || t('login_facebook_error'));
      if (__DEV__) console.warn('signInWithFacebook', e);
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  }, [isLoading, router, setIsLoggedIn, setUserInfo, t]);

  const onSocialPress = useCallback(
    (provider: SocialProvider) => {
      if (isLoading) return;
      setLoadingProvider(provider);
      setIsLoading(true);
      void handleSocialLogin();
    },
    [isLoading, handleSocialLogin]
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.inner}>
          
          {/* Logo Section */}
          <View style={styles.logoContainer}>
            <Image 
              // Logo path bhi root assets folder ke hisab se set kiya hai
              source={require('../../assets/images/splash-logo.png')} 
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>{t('login_title')}</Text>
            <Text style={styles.subtitle}>{t('login_subtitle')}</Text>
          </View>

          {/* Social Buttons Section */}
          <View style={styles.buttonWrapper}>
            
            {/* Google Login */}
            <TouchableOpacity
              style={[styles.socialBtn, { backgroundColor: Colors.cardBg, ...Colors.cardShadow, elevation: Colors.cardElevation }]}
              onPress={() => void handleGoogleLogin()}
              disabled={isLoading}
              accessibilityState={{ disabled: isLoading }}
            >
              {isLoading && loadingProvider === 'google' ? (
                <ActivityIndicator size="small" color="#555" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={24} color="#DB4437" />
                  <Text style={[styles.socialBtnText, { color: '#555' }]}>
                    {t('continue_google')}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* Facebook Login */}
            <TouchableOpacity
              style={[styles.socialBtn, { backgroundColor: '#1877F2' }]}
              onPress={() => void signInWithFacebook()}
              disabled={isLoading}
              accessibilityState={{ disabled: isLoading }}
            >
              {isLoading && loadingProvider === 'facebook' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="logo-facebook" size={24} color="white" />
                  <Text style={styles.socialBtnText}>{t('continue_facebook')}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Twitter (X) Login */}
            <TouchableOpacity
              style={[styles.socialBtn, { backgroundColor: '#000000' }]}
              onPress={() => onSocialPress('twitter')}
              disabled={isLoading}
              accessibilityState={{ disabled: isLoading }}
            >
              {isLoading && loadingProvider === 'twitter' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="logo-twitter" size={24} color="white" />
                  <Text style={styles.socialBtnText}>{t('continue_twitter')}</Text>
                </>
              )}
            </TouchableOpacity>

          </View>

          {/* Play Store: Terms of Service + Privacy Policy links on login */}
          <View style={styles.legalLinks}>
            <TouchableOpacity
              onPress={() => router.push('/terms')}
              accessibilityRole="link"
              accessibilityLabel={t('terms_of_service')}
            >
              <Text style={styles.legalLinkText}>{t('terms_of_service')}</Text>
            </TouchableOpacity>
            <Text style={styles.legalSeparator}> · </Text>
            <TouchableOpacity
              onPress={() => router.push('/privacy-policy')}
              accessibilityRole="link"
              accessibilityLabel={t('privacy_policy')}
            >
              <Text style={styles.legalLinkText}>{t('privacy_policy')}</Text>
            </TouchableOpacity>
          </View>

          {/* Footer Info */}
          <View style={styles.footer}>
            <Ionicons name="shield-checkmark-outline" size={16} color={Colors.secondary} />
            <Text style={styles.footerText}> 
              {t('secure_login')}
            </Text>
          </View>

        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContainer: { flexGrow: 1, justifyContent: 'center' },
  inner: { padding: 30, alignItems: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: 50 },
  logo: { width: 120, height: 120 },
  title: { fontSize: 32, fontWeight: 'bold', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold, marginTop: 10 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
  buttonWrapper: { width: '100%', gap: 15 },
  socialBtn: { 
    flexDirection: 'row',
    height: 60, 
    borderRadius: Colors.borderRadius, 
    justifyContent: 'center', 
    alignItems: 'center', 
    width: '100%',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  socialBtnText: { 
    color: '#FFF', 
    fontSize: 16, 
    fontWeight: '600', 
    marginLeft: 15 
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 12,
  },
  legalLinkText: {
    color: Colors.secondary,
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  legalSeparator: {
    color: '#888',
    fontSize: 14,
  },
  footer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginTop: 50,
    backgroundColor: Colors.successBg,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20
  },
  footerText: { color: Colors.secondary, fontSize: 13, fontWeight: '500' }
});