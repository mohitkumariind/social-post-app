import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const { width } = Dimensions.get('window');

// Sample Data with Previous Rank
const LEADERBOARD_DATA = [
  { id: '1', name: 'Mohit Kumar', points: 2540, rank: 1, prevRank: 1, image: 'https://i.pravatar.cc/150?u=1' },
  { id: '2', name: 'Rajesh Singh', points: 2100, rank: 2, prevRank: 3, image: 'https://i.pravatar.cc/150?u=2' }, // Jumped up
  { id: '3', name: 'Amit Sharma', points: 1850, rank: 3, prevRank: 2, image: 'https://i.pravatar.cc/150?u=3' }, // Dropped down
  { id: '4', name: 'Vikram Brar', points: 1420, rank: 4, prevRank: 4, image: 'https://i.pravatar.cc/150?u=4' },
  { id: '5', name: 'Sandeep Kaur', points: 1200, rank: 5, prevRank: 7, image: 'https://i.pravatar.cc/150?u=5' },
  { id: '6', name: 'Deepak Gill', points: 980, rank: 6, prevRank: 5, image: 'https://i.pravatar.cc/150?u=6' },
  { id: '7', name: 'Sunil Verma', points: 850, rank: 7, prevRank: 6, image: 'https://i.pravatar.cc/150?u=7' },
  { id: '8', name: 'Priya Das', points: 720, rank: 8, prevRank: 10, image: 'https://i.pravatar.cc/150?u=8' },
  { id: '9', name: 'Arjun Mehra', points: 650, rank: 9, prevRank: 8, image: 'https://i.pravatar.cc/150?u=9' },
  { id: '10', name: 'Karan Johar', points: 500, rank: 10, prevRank: 9, image: 'https://i.pravatar.cc/150?u=10' },
];

const MY_INFO = { name: "You (Mohit)", points: 450, prevRank: 15, image: 'https://i.pravatar.cc/150?u=me' };

export default function LeaderboardScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const myCurrentRank = useMemo(() => {
    const higherUsers = LEADERBOARD_DATA.filter(user => user.points > MY_INFO.points).length;
    return higherUsers + 1;
  }, [MY_INFO.points]);

  const filteredData = LEADERBOARD_DATA.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(3, 10);

  // Rank Change Component
  const RankStatus = ({ current, previous }: { current: number, previous: number }) => {
    const diff = previous - current;
    if (diff > 0) {
      return (
        <View style={styles.statusRow}>
          <Ionicons name="caret-up" size={12} color="#4CAF50" />
          <Text style={[styles.statusText, { color: '#4CAF50' }]}>{diff}</Text>
        </View>
      );
    } else if (diff < 0) {
      return (
        <View style={styles.statusRow}>
          <Ionicons name="caret-down" size={12} color="#F44336" />
          <Text style={[styles.statusText, { color: '#F44336' }]}>{Math.abs(diff)}</Text>
        </View>
      );
    }
    return <Text style={[styles.statusText, { color: '#999', fontSize: 10 }]}>--</Text>;
  };

  const renderPodium = () => {
    const top3 = LEADERBOARD_DATA.slice(0, 3);
    return (
      <View style={styles.podiumContainer}>
        {/* Rank 2 */}
        <View style={[styles.podiumItem, { marginTop: 35 }]}>
          <View style={styles.podiumAvatarWrap}>
            <Image source={{ uri: top3[1].image }} style={styles.podiumAvatar} />
            <View style={[styles.pBadge, { backgroundColor: '#C0C0C0' }]}><Text style={styles.pBadgeT}>2</Text></View>
          </View>
          <Text style={styles.pName} numberOfLines={1}>{top3[1].name}</Text>
          <RankStatus current={top3[1].rank} previous={top3[1].prevRank} />
        </View>
        {/* Rank 1 */}
        <View style={styles.podiumItem}>
          <Ionicons name="trophy" size={28} color="#FFD700" style={{ marginBottom: 2 }} />
          <View style={[styles.podiumAvatarWrap, { borderColor: '#FFD700', borderWidth: 3 }]}>
            <Image source={{ uri: top3[0].image }} style={[styles.podiumAvatar, { width: 80, height: 80, borderRadius: 40 }]} />
            <View style={[styles.pBadge, { backgroundColor: '#FFD700', width: 26, height: 26, borderRadius: 13 }]}><Text style={[styles.pBadgeT, { color: '#000' }]}>1</Text></View>
          </View>
          <Text style={[styles.pName, { fontSize: 14, fontWeight: '900' }]} numberOfLines={1}>{top3[0].name}</Text>
          <RankStatus current={top3[0].rank} previous={top3[0].prevRank} />
        </View>
        {/* Rank 3 */}
        <View style={[styles.podiumItem, { marginTop: 45 }]}>
          <View style={styles.podiumAvatarWrap}>
            <Image source={{ uri: top3[2].image }} style={styles.podiumAvatar} />
            <View style={[styles.pBadge, { backgroundColor: '#CD7F32' }]}><Text style={styles.pBadgeT}>3</Text></View>
          </View>
          <Text style={styles.pName} numberOfLines={1}>{top3[2].name}</Text>
          <RankStatus current={top3[2].rank} previous={top3[2].prevRank} />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={['#4B6CB7', '#182848']} style={styles.headerGradient}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="chevron-back" size={24} color="#FFF" /></TouchableOpacity>
          <Text style={styles.headerTitle}>Leaderboard</Text>
          <View style={{ width: 40 }} />
        </View>
        {renderPodium()}
        <View style={styles.searchWrapper}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color="#999" />
            <TextInput placeholder="Search Top 10..." style={styles.searchInput} value={searchQuery} onChangeText={setSearchQuery} />
          </View>
        </View>
      </LinearGradient>

      <FlatList
        data={filteredData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 130, paddingTop: 10 }}
        renderItem={({ item }) => (
          <View style={styles.rankCard}>
            <View style={styles.rankBadgeContainer}>
              <Text style={styles.rankNumber}>{item.rank}</Text>
              <RankStatus current={item.rank} previous={item.prevRank} />
            </View>
            <Image source={{ uri: item.image }} style={styles.listAvatar} />
            <View style={styles.infoContainer}>
              <Text style={styles.listName}>{item.name}</Text>
              <Text style={styles.listSubText}>Top 10 Contributor</Text>
            </View>
            <View style={styles.pointsContainer}>
              <Text style={styles.pointsValue}>{item.points}</Text>
              <Text style={styles.pointsLabel}>Pts</Text>
            </View>
          </View>
        )}
      />

      {/* --- STICKY MY RANK BAR --- */}
      <View style={styles.myRankWrapper}>
        <LinearGradient colors={['#182848', '#4B6CB7']} style={styles.myRankGradient} start={{x:0, y:0}} end={{x:1, y:0}}>
          <View style={styles.myRankLeft}>
            <View style={{alignItems: 'center', marginRight: 10}}>
                <Text style={styles.myRankNum}>{myCurrentRank}</Text>
                <RankStatus current={myCurrentRank} previous={MY_INFO.prevRank} />
            </View>
            <Image source={{ uri: MY_INFO.image }} style={styles.myAvatar} />
            <View>
              <Text style={styles.myName}>{MY_INFO.name}</Text>
              <Text style={styles.myStatus}>Great progress!</Text>
            </View>
          </View>
          <View style={styles.myPointsBox}>
            <Text style={styles.myPoints}>{MY_INFO.points}</Text>
            <Text style={styles.myPtsLabel}>PTS</Text>
          </View>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  headerGradient: { paddingTop: 20, paddingBottom: 20, borderBottomLeftRadius: 35, borderBottomRightRadius: 35, elevation: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF' },
  podiumContainer: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', marginTop: 10 },
  podiumItem: { alignItems: 'center', width: width / 3.5 },
  podiumAvatarWrap: { position: 'relative', marginBottom: 5 },
  podiumAvatar: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: '#FFF' },
  pBadge: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  pBadgeT: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  pName: { color: '#FFF', fontWeight: '800', fontSize: 11, marginTop: 5, textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  statusText: { fontSize: 11, fontWeight: '700' },
  searchWrapper: { paddingHorizontal: 25, marginTop: 15 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13, fontWeight: '600' },
  rankCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 12, borderRadius: 18, marginBottom: 10, elevation: 1 },
  rankBadgeContainer: { width: 40, alignItems: 'center' },
  rankNumber: { fontSize: 14, fontWeight: '900', color: '#333' },
  listAvatar: { width: 42, height: 42, borderRadius: 21, marginHorizontal: 10 },
  infoContainer: { flex: 1 },
  listName: { fontSize: 14, fontWeight: '700' },
  listSubText: { fontSize: 10, color: '#999' },
  pointsContainer: { alignItems: 'flex-end' },
  pointsValue: { fontSize: 14, fontWeight: '900', color: '#4B6CB7' },
  pointsLabel: { fontSize: 8, color: '#999' },
  myRankWrapper: { position: 'absolute', bottom: 0, width: width, padding: 15 },
  myRankGradient: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 20, elevation: 8 },
  myRankLeft: { flexDirection: 'row', alignItems: 'center' },
  myRankNum: { fontSize: 18, fontWeight: '900', color: '#FFF' },
  myAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#FFF', marginRight: 10 },
  myName: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  myStatus: { color: 'rgba(255,255,255,0.7)', fontSize: 9 },
  myPointsBox: { alignItems: 'center' },
  myPoints: { color: '#FFD700', fontSize: 16, fontWeight: '900' },
  myPtsLabel: { color: '#FFF', fontSize: 8 }
});