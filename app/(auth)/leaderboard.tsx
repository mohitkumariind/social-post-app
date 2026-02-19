import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    Dimensions,
    FlatList,
    Image,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const { width } = Dimensions.get('window');

// --- DUMMY DATA ---
const LEADERS = [
  { id: '1', name: 'Rahul Sharma', points: '12,500', rank: 1, avatar: 'https://i.pravatar.cc/150?u=1' },
  { id: '2', name: 'Amit Verma', points: '10,200', rank: 2, avatar: 'https://i.pravatar.cc/150?u=2' },
  { id: '3', name: 'Surbhi Jain', points: '9,800', rank: 3, avatar: 'https://i.pravatar.cc/150?u=3' },
  { id: '4', name: 'Mohit (You)', points: '8,500', rank: 4, avatar: 'https://i.pravatar.cc/150?u=4' },
  { id: '5', name: 'Deepak Singh', points: '7,200', rank: 5, avatar: 'https://i.pravatar.cc/150?u=5' },
  { id: '6', name: 'Karan Mehra', points: '6,500', rank: 6, avatar: 'https://i.pravatar.cc/150?u=6' },
  { id: '7', name: 'Pooja Vats', points: '5,900', rank: 7, avatar: 'https://i.pravatar.cc/150?u=7' },
];

export default function LeaderboardScreen() {
  const router = useRouter();

  const renderLeaderRow = ({ item }: { item: typeof LEADERS[0] }) => (
    <View style={[styles.leaderRow, item.rank === 4 && styles.myRankRow]}>
      <Text style={styles.rankNumber}>{item.rank}</Text>
      <Image source={{ uri: item.avatar }} style={styles.listAvatar} />
      <View style={styles.nameContainer}>
        <Text style={[styles.leaderName, item.rank === 4 && styles.myRankText]}>{item.name}</Text>
        <Text style={styles.subText}>Sharer Expert</Text>
      </View>
      <View style={styles.pointsBadge}>
        <Text style={styles.pointsText}>{item.points}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* 1. TOP HEADER SECTION */}
      <LinearGradient colors={['#8A2BE2', '#4B0082']} style={styles.topSection}>
        <View style={styles.headerNav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Leaderboard</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* 2. PODIUM (Rank 1, 2, 3) */}
        <View style={styles.podiumContainer}>
          {/* Rank 2 */}
          <View style={[styles.podiumItem, { marginTop: 40 }]}>
            <View style={styles.avatarWrapper}>
              <Image source={{ uri: LEADERS[1].avatar }} style={styles.podiumAvatar} />
              <View style={[styles.rankBadge, { backgroundColor: '#C0C0C0' }]}>
                <Text style={styles.rankBadgeText}>2</Text>
              </View>
            </View>
            <Text style={styles.podiumUser}>{LEADERS[1].name.split(' ')[0]}</Text>
            <Text style={styles.podiumPoints}>{LEADERS[1].points}</Text>
          </View>

          {/* Rank 1 (Tallest) */}
          <View style={styles.podiumItem}>
            <View style={styles.avatarWrapper}>
              <Ionicons name="trophy" size={26} color="#FFD700" style={styles.crownIcon} />
              <Image source={{ uri: LEADERS[0].avatar }} style={[styles.podiumAvatar, styles.rank1Border]} />
              <View style={[styles.rankBadge, { backgroundColor: '#FFD700' }]}>
                <Text style={styles.rankBadgeText}>1</Text>
              </View>
            </View>
            <Text style={[styles.podiumUser, { fontSize: 16 }]}>{LEADERS[0].name.split(' ')[0]}</Text>
            <Text style={styles.podiumPoints}>{LEADERS[0].points}</Text>
          </View>

          {/* Rank 3 */}
          <View style={[styles.podiumItem, { marginTop: 50 }]}>
            <View style={styles.avatarWrapper}>
              <Image source={{ uri: LEADERS[2].avatar }} style={styles.podiumAvatar} />
              <View style={[styles.rankBadge, { backgroundColor: '#CD7F32' }]}>
                <Text style={styles.rankBadgeText}>3</Text>
              </View>
            </View>
            <Text style={styles.podiumUser}>{LEADERS[2].name.split(' ')[0]}</Text>
            <Text style={styles.podiumPoints}>{LEADERS[2].points}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* 3. LIST OF OTHER USERS */}
      <View style={styles.listWrapper}>
        <FlatList
          data={LEADERS.slice(3)}
          keyExtractor={(item) => item.id}
          renderItem={renderLeaderRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  topSection: {
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingBottom: 40,
    borderBottomLeftRadius: 45,
    borderBottomRightRadius: 45,
  },
  headerNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF' },

  podiumContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', marginTop: 30 },
  podiumItem: { alignItems: 'center', width: width / 3.5 },
  avatarWrapper: { position: 'relative', marginBottom: 10 },
  podiumAvatar: { width: 70, height: 70, borderRadius: 35, borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)' },
  rank1Border: { width: 85, height: 85, borderRadius: 42.5, borderColor: '#FFD700', borderWidth: 4 },
  crownIcon: { position: 'absolute', top: -22, alignSelf: 'center', transform: [{ rotate: '0deg' }] },
  rankBadge: { position: 'absolute', bottom: -5, alignSelf: 'center', paddingHorizontal: 8, borderRadius: 10, borderWidth: 2, borderColor: '#FFF' },
  rankBadgeText: { color: '#FFF', fontWeight: 'bold', fontSize: 10 },
  podiumUser: { color: '#FFF', fontWeight: '800', marginTop: 5, fontSize: 13 },
  podiumPoints: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },

  listWrapper: { flex: 1, marginTop: -20, backgroundColor: '#FFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20 },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  myRankRow: { backgroundColor: '#F9F5FF', borderRadius: 20, paddingHorizontal: 10, borderBottomWidth: 0, marginVertical: 5 },
  rankNumber: { width: 30, fontSize: 16, fontWeight: '800', color: '#999' },
  listAvatar: { width: 45, height: 45, borderRadius: 22.5, marginRight: 15 },
  nameContainer: { flex: 1 },
  leaderName: { fontSize: 15, fontWeight: '700', color: '#333' },
  myRankText: { color: '#8A2BE2' },
  subText: { fontSize: 11, color: '#AAA' },
  pointsBadge: { backgroundColor: '#F0E6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  pointsText: { color: '#8A2BE2', fontWeight: '800', fontSize: 12 },
});