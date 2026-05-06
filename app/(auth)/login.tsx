import { Ionicons } from '@expo/vector-icons';
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
import { normalizePartyId } from '../../constants/Parties';
import { SUPPORTED_LANGS, useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { ensurePushTokenRegisteredAndSaved } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { getGoogleSignInConfigureParams, getGoogleWebClientId } from '../../src/utils/googleSignInConfig';

export default function LoginScreen() {
  const router = useRouter();
  const { t, changeLanguage } = useLang();
  const { setIsLoggedIn, setUserInfo } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  /** Which social button is showing the spinner (only that row replaces icon + text). */
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const webClientId = getGoogleWebClientId();
    if (!webClientId) return;
    GoogleSignin.configure(
      getGoogleSignInConfigureParams(webClientId) as Parameters<typeof GoogleSignin.configure>[0]
    );
  }, []);

  /** Google Sign-In → idToken → Supabase session → profile check → dashboard or /language → /party */
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

    setGoogleLoading(true);
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
      const nameRaw =
        (sbUser.user_metadata?.full_name as unknown) ??
        (sbUser.user_metadata?.name as unknown) ??
        (gUser as unknown as { name?: unknown } | null)?.name ??
        '';
      const name = String(nameRaw ?? '').trim();
      const email = String(sbUser.email ?? gUser.email ?? '').trim();
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
      if (profileError && __DEV__) console.error('Profile Upsert Error:', profileError);

      const { data: profileRow, error: profileFetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sbUser.id)
        .single();

      if (profileFetchError && __DEV__) {
        console.warn('[Login] profiles fetch:', profileFetchError.message);
      }

      const row = (profileRow ?? {}) as Record<string, unknown>;
      /** Relogin skip: both `profiles.language` and `profiles.party` must be set (not null / not empty). */
      const langCell = row.language;
      const partyCell = row.party ?? row.party_id;
      const langRaw =
        langCell != null && String(langCell).trim() !== '' ? String(langCell).trim() : '';
      const rawParty =
        partyCell != null && String(partyCell).trim() !== '' ? String(partyCell).trim() : '';
      const partyCanon = rawParty ? normalizePartyId(rawParty) || rawParty : '';
      const hasLang =
        langRaw.length > 0 && (SUPPORTED_LANGS as readonly string[]).includes(langRaw);
      const hasParty = partyCanon.length > 0;

      const baseUser = { name, email, avatar_url: String(photoUrl ?? '').trim() };

      if (hasLang && hasParty) {
        changeLanguage(langRaw);
        setUserInfo((prev) => ({
          ...prev,
          ...baseUser,
          profile_id: sbUser.id,
          language: langRaw,
          partyName: partyCanon,
          name: String(row.name ?? '').trim() || baseUser.name,
          phone: String(row.phone ?? '').trim() || prev.phone,
          state: String(row.state ?? '').trim() || prev.state,
          state_id:
            typeof row.state_id === 'number'
              ? row.state_id
              : row.state_id != null
                ? Number(row.state_id)
                : prev.state_id,
          group_id:
            typeof row.group_id === 'number'
              ? row.group_id
              : row.group_id != null
                ? Number(row.group_id)
                : prev.group_id,
          loksabha_id:
            typeof row.loksabha_id === 'number'
              ? row.loksabha_id
              : row.loksabha_id != null
                ? Number(row.loksabha_id)
                : prev.loksabha_id,
          loksabha: String(row.loksabha ?? '').trim() || prev.loksabha,
          assembly_id:
            typeof row.assembly_id === 'number'
              ? row.assembly_id
              : row.assembly_id != null
                ? Number(row.assembly_id)
                : prev.assembly_id,
          assembly: String(row.assembly ?? '').trim() || prev.assembly,
          avatar_url: String(row.avatar_url ?? '').trim() || baseUser.avatar_url,
          designation1: String(row.designation1 ?? row.designation ?? '').trim() || prev.designation1,
          designation2: String(row.designation2 ?? '').trim() || prev.designation2,
          designation3: String(row.designation3 ?? '').trim() || prev.designation3,
          designation4: String(row.designation4 ?? '').trim() || prev.designation4,
          whatsapp: String(row.whatsapp ?? '').trim() || prev.whatsapp,
          facebook: String(row.facebook ?? '').trim() || prev.facebook,
          instagram: String(row.instagram ?? '').trim() || prev.instagram,
          twitter: String(row.twitter ?? '').trim() || prev.twitter,
        }));
        setIsLoggedIn(true);
        void ensurePushTokenRegisteredAndSaved();
        router.replace('/(tabs)/dashboard');
        return;
      }

      setUserInfo((prev) => ({
        ...prev,
        ...baseUser,
      }));
      setIsLoggedIn(true);
      void ensurePushTokenRegisteredAndSaved();
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
      setGoogleLoading(false);
    }
  }, [changeLanguage, isLoading, router, setIsLoggedIn, setUserInfo, t]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.inner}>
          
          {/* Logo Section */}
          <View style={styles.logoContainer}>
            <Image 
              // Logo path bhi root assets folder ke hisab se set kiya hai
              source={require('../../assets/images/icon.png')} 
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
              style={[styles.socialBtn, { backgroundColor: Colors.secondary, ...Colors.cardShadow, elevation: Colors.cardElevation }]}
              onPress={() => void handleGoogleLogin()}
              disabled={isLoading}
              accessibilityState={{ disabled: isLoading }}
            >
              {googleLoading ? (
                <ActivityIndicator size="small" color={Colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons name="logo-google" size={24} color={Colors.textOnPrimary} />
                  <Text style={[styles.socialBtnText, { color: Colors.textOnPrimary }]}>
                    {t('continue_google')}
                  </Text>
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