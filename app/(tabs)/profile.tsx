import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Dimensions,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';
import { EMPTY_USER_INFO, useUser } from '../../context/UserContext';
import { signOutApp } from '../../lib/supabase';

const { width } = Dimensions.get('window');

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { userInfo, setUserInfo, setIsLoggedIn } = useUser();

  const handleLogout = async () => {
    await signOutApp(); // clears session + Google only; `profiles` row unchanged
    setUserInfo({ ...EMPTY_USER_INFO });
    setIsLoggedIn(false);
    router.replace('/login');
  };

  const currentPhoto = userInfo?.avatar_url?.trim() ?? '';

  const handleRateApp = () => {
    const GOOGLE_PACKAGE_NAME = 'com.mohit.socialpost.app';
    const url = Platform.OS === 'android'
      ? `market://details?id=${GOOGLE_PACKAGE_NAME}`
      : `https://play.google.com/store/apps/details?id=${GOOGLE_PACKAGE_NAME}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${GOOGLE_PACKAGE_NAME}`));
  };

  const renderMenuItem = (icon: string, label: string, onPress: () => void, isLogout = false) => (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.menuLeft}>
        <View style={[styles.iconCircle, isLogout && { backgroundColor: '#FFF0F0' }]}>
          <Ionicons name={icon as any} size={22} color={isLogout ? Colors.error : Colors.text} />
        </View>
        <Text style={[styles.menuLabel, isLogout && { color: Colors.error }]}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#CCC" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.topSection}>
          <View style={[styles.gradientBg, { backgroundColor: Colors.primary }]} />
          <View style={styles.headerNav}>
            <TouchableOpacity onPress={() => router.back()} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={22} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('my_profile')}</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.profileInfo}>
            <View style={styles.avatarWrapper}>
              {currentPhoto ? (
                <ExpoImage
                  source={{ uri: currentPhoto }}
                  style={styles.mainAvatar}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              ) : (
                <View style={[styles.mainAvatar, styles.avatarPlaceholderInner]}>
                  <Ionicons name="person" size={48} color={Colors.textMuted} />
                </View>
              )}
            </View>
            <Text style={styles.userName}>{userInfo?.name || t('default_user_name')}</Text>
            <Text style={styles.userRole}>{userInfo?.designation1 || t('default_designation_profile')}</Text>
            <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/edit-profile')}>
              <Text style={styles.editBtnText}>{t('edit_profile')}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.menuContainer}>
          {renderMenuItem('person-outline', t('personal_political_details'), () => router.push('/edit-profile'))}
          {renderMenuItem('trophy-outline', t('leaderboard'), () => router.push('/leaderboard'))}
          {renderMenuItem('medal-outline', t('rewards'), () => router.push('/rewards'))}
          {renderMenuItem('gift-outline', t('refer_earn'), () => router.push('/refer'))}
          {renderMenuItem('document-text-outline', t('privacy_policy'), () => router.push('/privacy-policy'))}
          {renderMenuItem('shield-checkmark-outline', t('terms_conditions'), () => router.push('/terms'))}
          {renderMenuItem('star-outline', t('rate_app'), handleRateApp)}
          {renderMenuItem('help-circle-outline', t('help_support'), () => router.push('/support'))}
          {renderMenuItem('log-out-outline', t('logout'), () => void handleLogout(), true)}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topSection: { height: 400, alignItems: 'center' },
  gradientBg: { position: 'absolute', top: 0, width: width, height: 220, borderBottomLeftRadius: 60, borderBottomRightRadius: 60 },
  headerNav: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 40 : 10 },
  navBtn: { width: 40, height: 40, borderRadius: Colors.borderRadiusSm, backgroundColor: 'rgba(255,255,255,0.9)', justifyContent: 'center', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  profileInfo: { alignItems: 'center', marginTop: 35, zIndex: 10 },
  avatarWrapper: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#FFF', padding: 4, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 8 },
  mainAvatar: { width: '100%', height: '100%', borderRadius: 60 },
  avatarPlaceholderInner: { backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' },
  userName: { fontSize: 24, fontWeight: '800', marginTop: 20, color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  userRole: { fontSize: 14, color: Colors.textMuted, marginTop: 5, fontWeight: '500' },
  editProfileBtn: { marginTop: 20, backgroundColor: Colors.primary, paddingHorizontal: 30, paddingVertical: 12, borderRadius: Colors.borderRadius },
  editBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  menuContainer: { paddingHorizontal: 25, marginTop: 10 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F8F8F8' },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  iconCircle: { width: 42, height: 42, borderRadius: Colors.borderRadiusSm, backgroundColor: Colors.cardBg, justifyContent: 'center', alignItems: 'center', ...Colors.cardShadow, elevation: Colors.cardElevation },
  menuLabel: { fontSize: 15, fontWeight: '600', color: Colors.text }
});
