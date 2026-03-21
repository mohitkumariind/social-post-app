import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useRef } from 'react';
import {
    Alert,
    Dimensions,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import ViewShot from "react-native-view-shot";

const { width } = Dimensions.get('window');

const ALL_RANKS = [
  { lv: 1, name: 'Volunteer', icon: 'person', color: '#95A5A6' },
  { lv: 2, name: 'Guard', icon: 'shield', color: '#7F8C8D' },
  { lv: 3, name: 'Soldier', icon: 'shield-half', color: '#27AE60' },
  { lv: 4, name: 'Commando', icon: 'shield-checkmark', color: Colors.primary },
  { lv: 5, name: 'Captain', icon: 'star', color: Colors.accent },
  { lv: 6, name: 'Commander', icon: 'star-half', color: '#D35400' },
  { lv: 7, name: 'Chief', icon: 'star-sharp', color: '#C0392B' },
  { lv: 8, name: 'Marshal', icon: 'ribbon', color: '#16A085' },
  { lv: 9, name: 'Supremo', icon: 'medal', color: '#F1C40F' },
  { lv: 10, name: 'Samrat', icon: 'trophy', color: '#FFD700' },
];

export default function RewardsScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { userInfo } = useUser();
  const viewShotRef = useRef<any>(null);

  const displayName = (userInfo?.name ?? '').trim() || t('default_user_name');
  const currentLevel = 1;
  const currentPoints = 0;
  const nextLevelPoints = 5000;
  const progress = nextLevelPoints > 0 ? Math.min(100, (currentPoints / nextLevelPoints) * 100) : 0;

  const earnedBadges = ALL_RANKS.filter((rank) => rank.lv <= currentLevel);

  const captureAndShare = async () => {
    if (Platform.OS === 'web') {
      Alert.alert("Note", "Image sharing mobile par hi chalti hai bhai!");
      return;
    }
    try {
      const uri = await viewShotRef.current.capture();
      await Sharing.shareAsync(uri);
    } catch (error) {
      Alert.alert("Error", "Share nahi ho paya!");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color="#333" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Army Rewards</Text>
        <TouchableOpacity onPress={captureAndShare}><Ionicons name="share-social-outline" size={24} color={Colors.text} /></TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        
        {/* --- TOP: CERTIFICATE --- */}
        <View style={styles.certContainer}>
          <ViewShot ref={viewShotRef} options={{ format: "png", quality: 1.0 }}>
            <View style={[styles.certCard, { backgroundColor: Colors.cardBg }]}>
              <View style={styles.certWatermark}><Ionicons name="medal" size={180} color="rgba(0,0,0,0.05)" /></View>
              <View style={styles.certHeader}>
                <Ionicons name="ribbon" size={40} color={Colors.primary} />
                <Text style={styles.certRankTitle}>CURRENT ACHIEVEMENT</Text>
              </View>
              <View style={styles.certBody}>
                <Text style={styles.userName}>{displayName}</Text>
                <Text style={styles.userRankText}>{ALL_RANKS[currentLevel-1].name} - Social Media</Text>
                <View style={styles.divider} />
                <Text style={styles.certQuote}>"Serving on the Digital Frontline"</Text>
              </View>
            </View>
          </ViewShot>
          <TouchableOpacity style={styles.actionBtn} onPress={captureAndShare}>
            <Ionicons name="logo-whatsapp" size={18} color="#FFF" />
            <Text style={styles.actionBtnText}>Share Status</Text>
          </TouchableOpacity>
        </View>

        {/* --- MIDDLE: TRACKER --- */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Promotion Tracker</Text>
          <View style={[styles.progressCard, { backgroundColor: Colors.cardBg }]}>
             <View style={styles.levelRow}>
                <View style={styles.levelCircle}><Text style={styles.levelText}>{currentLevel}</Text></View>
                <View style={{marginLeft: 15}}>
                   <Text style={styles.lvLabel}>Active Rank</Text>
                   <Text style={styles.lvName}>{ALL_RANKS[currentLevel-1].name}</Text>
                </View>
             </View>
             <View style={styles.barBg}><View style={[styles.barFill, {width: `${progress}%`}]} /></View>
             <Text style={styles.pointsHint}>{nextLevelPoints - currentPoints} points left for promotion</Text>
          </View>
        </View>

        {/* --- REDESIGNED: EARNED RANK BADGES (Premium Medallion Cards) --- */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Earned Rank Badges</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgesHorizontalScroll}>
             {earnedBadges.map((badge) => (
               <View key={badge.lv} style={styles.badgeVerticalCard}>
                  <View style={[styles.badgeIconCircle, { backgroundColor: badge.color }]}>
                    <Ionicons name={badge.icon as any} size={32} color="#FFF" />
                  </View>
                  <Text style={styles.badgeNameLabel}>{badge.name}</Text>
                  <Text style={styles.badgeLvlSub}>LVL #{badge.lv}</Text>
               </View>
             ))}
          </ScrollView>
        </View>

        {/* --- BOTTOM: HONORARY TITLES (Victory Podium) --- */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Elite Hall of Fame</Text>
          <View style={styles.podiumContainer}>
            
            {/* 2nd Place: MONTH */}
            <View style={styles.podiumSlot}>
              <Ionicons name="medal" size={32} color="#C0C0C0" />
              <Text style={styles.podiumName}>Subedar</Text>
              <View style={[styles.podiumBar, { height: 60, backgroundColor: '#C0C0C0' }]}>
                <Text style={styles.podiumLabel}>Month</Text>
              </View>
            </View>

            {/* 1st Place: YEAR */}
            <View style={[styles.podiumSlot, { marginTop: -20 }]}>
              <Ionicons name="ribbon" size={42} color="#FFD700" />
              <Text style={[styles.podiumName, {fontWeight: '900'}]}>General</Text>
              <View style={[styles.podiumBar, { height: 90, backgroundColor: '#FFD700' }]}>
                <Text style={[styles.podiumLabel, { color: '#182848' }]}>Year</Text>
              </View>
            </View>

            {/* 3rd Place: WEEK */}
            <View style={styles.podiumSlot}>
              <Ionicons name="shield-checkmark" size={28} color="#CD7F32" />
              <Text style={styles.podiumName}>Commando</Text>
              <View style={[styles.podiumBar, { height: 45, backgroundColor: '#CD7F32' }]}>
                <Text style={styles.podiumLabel}>Week</Text>
              </View>
            </View>

          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, height: 60, backgroundColor: Colors.background, marginTop: Platform.OS === 'android' ? 35 : 0 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  
  certContainer: { padding: 20, alignItems: 'center' },
  certCard: { height: 280, width: width - 40, borderRadius: Colors.borderRadius, padding: 24, alignItems: 'center', justifyContent: 'center', ...Colors.cardShadow, elevation: Colors.cardElevation },
  certWatermark: { position: 'absolute' },
  certHeader: { alignItems: 'center', marginBottom: 10 },
  certRankTitle: { color: Colors.primary, fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  certBody: { alignItems: 'center' },
  userName: { color: Colors.text, fontSize: 26, fontWeight: '800' },
  userRankText: { color: Colors.textMuted, fontSize: 16, fontWeight: '700', marginTop: 5 },
  divider: { height: 2, width: 80, backgroundColor: Colors.borderLight, marginVertical: 16 },
  certQuote: { color: Colors.textMuted, fontSize: 12, fontWeight: '500', fontStyle: 'italic' },
  actionBtn: { flexDirection: 'row', backgroundColor: Colors.primary, paddingHorizontal: 25, paddingVertical: 12, borderRadius: 12, gap: 10, marginTop: -25, elevation: 4 },
  actionBtnText: { fontWeight: '800', color: '#FFF' },

  section: { marginTop: 30, paddingHorizontal: 20 },
  sectionLabel: { fontSize: 18, fontWeight: '900', color: Colors.text, marginBottom: 15 },
  
  progressCard: { padding: 20, borderRadius: Colors.borderRadius, ...Colors.cardShadow, elevation: Colors.cardElevation },
  levelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  levelCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(67, 160, 71, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: Colors.primary },
  levelText: { color: Colors.primary, fontSize: 22, fontWeight: '900' },
  lvLabel: { color: Colors.textMuted, fontSize: 10 },
  lvName: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  barBg: { height: 8, backgroundColor: Colors.borderLight, borderRadius: 4 },
  barFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 4 },
  pointsHint: { color: Colors.textMuted, fontSize: 11, marginTop: 10 },

  /* --- BADGES REDESIGN --- */
  badgesHorizontalScroll: { paddingRight: 20, paddingBottom: 10 },
  badgeVerticalCard: { width: 110, backgroundColor: Colors.white, borderRadius: 12, padding: 16, alignItems: 'center', marginRight: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  badgeIconCircle: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginBottom: 12, elevation: 2 },
  badgeNameLabel: { fontSize: 11, fontWeight: '800', color: '#333', textAlign: 'center' },
  badgeLvlSub: { fontSize: 9, color: '#999', marginTop: 4, fontWeight: 'bold' },

  /* --- PODIUM --- */
  podiumContainer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', backgroundColor: Colors.cardBg, paddingVertical: 24, borderRadius: Colors.borderRadius, ...Colors.cardShadow, elevation: Colors.cardElevation },
  podiumSlot: { alignItems: 'center', width: (width - 100) / 3 },
  podiumName: { fontSize: 12, fontWeight: '800', marginVertical: 8 },
  podiumBar: { width: '85%', borderTopLeftRadius: 10, borderTopRightRadius: 10, justifyContent: 'center', alignItems: 'center' },
  podiumLabel: { color: '#FFF', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }
});