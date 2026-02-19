import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Dimensions,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useUser } from '../../context/UserContext';

const { width } = Dimensions.get('window');

export default function ProfileScreen() {
  const router = useRouter();
  const { userInfo } = useUser();
  
  const [currentLang, setCurrentLang] = useState('English'); 
  const [showLangList, setShowLangList] = useState(false);

  const currentPhoto = userInfo.profilePics[userInfo.activePhotoIndex] || userInfo.profilePics[0];
  const languages = ["English", "Hindi", "Punjabi", "Marathi", "Gujrati"];

  const renderMenuItem = (icon: string, label: string, onPress: () => void, isLogout = false) => (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.menuLeft}>
        <View style={styles.iconCircle}>
          <Ionicons name={icon as any} size={22} color={isLogout ? "#FF4D4D" : "#333"} />
        </View>
        <Text style={[styles.menuLabel, isLogout && { color: "#FF4D4D" }]}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#CCC" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
        
        {/* --- HEADER --- */}
        <View style={styles.topSection}>
          <LinearGradient colors={['#D4FC79', '#96E6A1']} style={styles.gradientBg} />
          
          <View style={styles.headerNav}>
            <TouchableOpacity onPress={() => router.back()} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={22} color="#333" />
            </TouchableOpacity>
            
            <View style={{ alignItems: 'flex-end' }}>
              <TouchableOpacity style={styles.langBtn} onPress={() => setShowLangList(!showLangList)}>
                <Text style={styles.langText}>{currentLang}</Text>
                <Ionicons name={showLangList ? "chevron-up" : "chevron-down"} size={14} color="#333" />
              </TouchableOpacity>

              {showLangList && (
                <View style={styles.floatingLangList}>
                  {languages.map((lang) => (
                    <TouchableOpacity 
                      key={lang} 
                      style={styles.langItem}
                      onPress={() => { setCurrentLang(lang); setShowLangList(false); }}
                    >
                      <Text style={[styles.langItemText, currentLang === lang && { color: '#8A2BE2' }]}>{lang}</Text>
                      {currentLang === lang && <Ionicons name="checkmark" size={14} color="#8A2BE2" />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

          <View style={styles.profileInfo}>
            <View style={styles.avatarWrapper}>
              <Image source={{ uri: currentPhoto }} style={styles.mainAvatar} />
            </View>
            <Text style={styles.userName}>{userInfo.name || "Neta Ji"}</Text>
            <Text style={styles.designationText}>{userInfo.designation || 'Political Leader'}</Text>
            
            <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/edit-profile')}>
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* --- STATS BAR (UPER ME) --- */}
        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>1,450</Text>
            <Text style={styles.statLabel}>Total Pts</Text>
          </View>
          <View style={[styles.statBox, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#F0F0F0' }]}>
            <Text style={styles.statNumber}>#1,245</Text>
            <Text style={styles.statLabel}>National Rank</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>#104</Text>
            <Text style={styles.statLabel}>State Rank</Text>
          </View>
        </View>

        {/* --- MENU LIST (FOLLOWING YOUR ORDER) --- */}
        <View style={styles.menuContainer}>
          {renderMenuItem('person-outline', 'Personal & Political details', () => router.push('/edit-profile'))}
          {renderMenuItem('trophy-outline', 'Leaderboard', () => {})}
          {renderMenuItem('medal-outline', 'Rewards', () => {})}
          {renderMenuItem('gift-outline', 'Refer & Earn', () => {})}
          {renderMenuItem('document-text-outline', 'privacy policy', () => {})}
          {renderMenuItem('shield-checkmark-outline', 'Term & Condition', () => {})}
          {renderMenuItem('star-outline', 'Rate Our App', () => {})}
          {renderMenuItem('help-circle-outline', 'Help & Support', () => {})}
          {renderMenuItem('log-out-outline', 'Logout', () => router.replace('/login'), true)}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  topSection: { height: 380, alignItems: 'center', position: 'relative', zIndex: 100 },
  gradientBg: { position: 'absolute', top: 0, width: width, height: 260, borderBottomLeftRadius: width/2, borderBottomRightRadius: width/2, transform: [{ scaleX: 1.5 }] },
  headerNav: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 45 : 10, zIndex: 200 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 3 },
  langBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 15, height: 40, borderRadius: 20, gap: 5, elevation: 3 },
  langText: { fontSize: 13, fontWeight: '700', color: '#333' },
  floatingLangList: { position: 'absolute', top: 45, right: 0, width: 130, backgroundColor: '#FFF', borderRadius: 15, padding: 10, elevation: 10, zIndex: 1000 },
  langItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#EEE' },
  langItemText: { fontSize: 14, fontWeight: '600', color: '#555' },
  profileInfo: { alignItems: 'center', marginTop: 15 },
  avatarWrapper: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF', padding: 5, elevation: 8 },
  mainAvatar: { width: '100%', height: '100%', borderRadius: 50 },
  userName: { fontSize: 22, fontWeight: '800', color: '#000', marginTop: 12 },
  designationText: { fontSize: 13, color: '#555', fontWeight: '600', marginTop: 4 },
  editProfileBtn: { marginTop: 15, backgroundColor: '#FFF', paddingHorizontal: 25, paddingVertical: 10, borderRadius: 25, borderWidth: 1, borderColor: '#EEE', elevation: 3 },
  editBtnText: { fontWeight: '800', color: '#000', fontSize: 14 },
  statsContainer: { flexDirection: 'row', backgroundColor: '#FFF', marginHorizontal: 25, marginTop: -30, borderRadius: 20, paddingVertical: 20, elevation: 5, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  statBox: { flex: 1, alignItems: 'center' },
  statNumber: { fontSize: 16, fontWeight: '800', color: '#333' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 2, fontWeight: '600' },
  menuContainer: { paddingHorizontal: 25, marginTop: 15 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F8F8F8' },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F9F9F9', justifyContent: 'center', alignItems: 'center' },
  menuLabel: { fontSize: 15, fontWeight: '600', color: '#333' }
});