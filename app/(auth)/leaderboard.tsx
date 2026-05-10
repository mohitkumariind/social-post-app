import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import {
  type LeaderboardEntry,
  fetchNationalPartyLeaderboard,
  fetchStatePartyLeaderboard,
  formatPointsLabel,
  sanitizeInstagramHandle,
} from '../../lib/leaderboardService';

const GOLD: readonly [string, string, string] = ['#FFE566', '#F5B041', '#D4A017'];
const SILVER: readonly [string, string, string] = ['#F8F8F8', '#D8D8D8', '#A8A8B0'];
const BRONZE: readonly [string, string, string] = ['#F0C27B', '#C68642', '#8B5A2B'];

function openInstagram(handle: string) {
  const h = sanitizeInstagramHandle(handle);
  if (!h) return;
  void Linking.openURL(`https://instagram.com/${encodeURIComponent(h)}`);
}

const InstagramSlot = React.memo(function InstagramSlot({ raw }: { raw: string }) {
  const h = useMemo(() => sanitizeInstagramHandle(raw), [raw]);
  if (!h) return <View style={styles.instaSlot} />;
  return (
    <TouchableOpacity
      style={styles.instaSlot}
      onPress={() => openInstagram(raw)}
      accessibilityLabel="Instagram"
      hitSlop={10}
    >
      <Ionicons name="logo-instagram" size={22} color="#E1306C" />
    </TouchableOpacity>
  );
});

const LeaderboardListRow = React.memo(function LeaderboardListRow({
  item,
}: {
  item: LeaderboardEntry;
}) {
  return (
    <View style={styles.listRow}>
      <Text style={styles.listRank}>{item.leader_rank}</Text>
      <View style={styles.listAvatarWrap}>
        {item.avatar_url ? (
          <ExpoImage source={{ uri: item.avatar_url }} style={styles.listAvatar} contentFit="cover" />
        ) : (
          <View style={[styles.listAvatar, styles.avatarPh]}>
            <Ionicons name="person" size={20} color={Colors.textMuted} />
          </View>
        )}
      </View>
      <View style={styles.listMid}>
        <Text style={styles.listName} numberOfLines={1}>
          {item.display_name}
        </Text>
        <Text style={styles.listPointsSub}>{formatPointsLabel(item.points)}</Text>
      </View>
      <InstagramSlot raw={item.instagram} />
    </View>
  );
});

function PodiumMedal({ place }: { place: 1 | 2 | 3 }) {
  const name = place === 1 ? 'trophy' : place === 2 ? 'star' : 'flame';
  const color = place === 1 ? '#FFD700' : place === 2 ? '#C0C0C0' : '#CD7F32';
  return (
    <View style={styles.medalWrap}>
      <Ionicons name={name as 'trophy' | 'star' | 'flame'} size={place === 1 ? 28 : 24} color={color} />
    </View>
  );
}

const PodiumCard = React.memo(function PodiumCard({
  entry,
  place,
  width,
  tall,
  colors,
}: {
  entry: LeaderboardEntry | undefined;
  place: 1 | 2 | 3;
  width: number;
  tall: boolean;
  colors: readonly [string, string, string];
}) {
  const h = tall ? 168 : 138;
  const ring = Math.min(width * 0.28, tall ? 104 : 88);
  if (!entry) {
    return (
      <View style={[styles.podiumCol, { width, minHeight: h, opacity: 0.45 }]}>
        <PodiumMedal place={place} />
        <LinearGradient colors={colors} style={[styles.podiumRing, { width: ring, height: ring, borderRadius: ring / 2 }]}>
          <View style={[styles.podiumInner, { width: ring - 6, height: ring - 6, borderRadius: (ring - 6) / 2 }]} />
        </LinearGradient>
        <Text style={styles.podiumNameMuted}>—</Text>
        <Text style={styles.podiumPtsMuted}>0 Points</Text>
      </View>
    );
  }
  return (
    <View style={[styles.podiumCol, { width, minHeight: h }]}>
      <PodiumMedal place={place} />
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.podiumRing,
          {
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            shadowColor: colors[2],
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.45,
            shadowRadius: 10,
            elevation: Platform.OS === 'android' ? 8 : 0,
          },
        ]}
      >
        {entry.avatar_url ? (
          <ExpoImage source={{ uri: entry.avatar_url }} style={[styles.podiumImg, { width: ring - 6, height: ring - 6, borderRadius: (ring - 6) / 2 }]} contentFit="cover" />
        ) : (
          <View style={[styles.podiumImg, styles.avatarPh, { width: ring - 6, height: ring - 6, borderRadius: (ring - 6) / 2 }]}>
            <Ionicons name="person" size={32} color={Colors.textMuted} />
          </View>
        )}
      </LinearGradient>
      <Text style={styles.podiumName} numberOfLines={1}>
        {entry.display_name}
      </Text>
      <Text style={styles.podiumPts}>{formatPointsLabel(entry.points)}</Text>
      <InstagramSlot raw={entry.instagram} />
    </View>
  );
});

export default function LeaderboardScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { t } = useLang();
  const { profileLoaded } = useUser();
  const [stateRows, setStateRows] = useState<LeaderboardEntry[]>([]);
  const [nationalRows, setNationalRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colW = useMemo(() => Math.min((width - 32) / 3, 118), [width]);

  const load = useCallback(async () => {
    setError(null);
    const [st, nat] = await Promise.all([fetchStatePartyLeaderboard(50), fetchNationalPartyLeaderboard(10)]);
    if (st.error || nat.error) {
      setError(st.error || nat.error || t('leaderboard_error'));
    }
    setStateRows(st.rows);
    setNationalRows(nat.rows);
  }, [t]);

  useEffect(() => {
    if (!profileLoaded) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileLoaded, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const restList = useMemo(() => (stateRows.length > 3 ? stateRows.slice(3) : []), [stateRows]);

  const podiumSecond = stateRows[1];
  const podiumFirst = stateRows[0];
  const podiumThird = stateRows[2];

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
        <Text style={styles.sectionTitle}>{t('leaderboard_state_heading')}</Text>
        <Text style={styles.sectionSub}>{t('leaderboard_total_points')}</Text>

        <Animated.View entering={FadeInDown.duration(420).springify()} style={styles.podiumRow}>
          <PodiumCard entry={podiumSecond} place={2} width={colW} tall={false} colors={SILVER} />
          <PodiumCard entry={podiumFirst} place={1} width={colW * 1.05} tall colors={GOLD} />
          <PodiumCard entry={podiumThird} place={3} width={colW} tall={false} colors={BRONZE} />
        </Animated.View>

        {!loading ? (
          <TouchableOpacity
            style={styles.rewardsBtnWrapper}
            activeOpacity={0.88}
            onPress={() => router.push('/rewards')}
          >
            <LinearGradient colors={[Colors.primary, '#2E7D32']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rewardsGradient}>
              <View style={styles.rewardsBtnContent}>
                <Ionicons name="medal-outline" size={24} color="#FFF" />
                <Text style={styles.rewardsBtnText}>{t('leaderboard_view_ranks_badges')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color="#FFF" />
            </LinearGradient>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.listSectionTitle}>
          {t('leaderboard_rank')} · Top 50
        </Text>
        {stateRows.length === 0 && !loading ? (
          <Text style={styles.emptyInline}>{t('leaderboard_empty_state')}</Text>
        ) : null}
      </View>
    ),
    [t, colW, podiumFirst, podiumSecond, podiumThird, stateRows.length, loading, router]
  );

  const listFooter = useMemo(
    () => (
      <View style={styles.footerBlock}>
        <LinearGradient colors={[Colors.primary, Colors.secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.nationalBanner}>
          <Text style={styles.nationalTitle}>{t('leaderboard_national_heading')}</Text>
          <Text style={styles.nationalSub}>{t('leaderboard_total_points')}</Text>
        </LinearGradient>
        {nationalRows.length === 0 && !loading ? (
          <Text style={styles.emptyInline}>{t('leaderboard_empty_national')}</Text>
        ) : (
          <FlatList
            data={nationalRows}
            keyExtractor={(it) => `nat-${it.profile_id}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.natListContent}
            renderItem={({ item }) => (
              <View style={styles.natCard}>
                <Text style={styles.natRank}>#{item.leader_rank}</Text>
                {item.avatar_url ? (
                  <ExpoImage source={{ uri: item.avatar_url }} style={styles.natAvatar} contentFit="cover" />
                ) : (
                  <View style={[styles.natAvatar, styles.avatarPh]}>
                    <Ionicons name="person" size={22} color={Colors.textMuted} />
                  </View>
                )}
                <Text style={styles.natName} numberOfLines={2}>
                  {item.display_name}
                </Text>
                <Text style={styles.natPts}>{formatPointsLabel(item.points)}</Text>
                <View style={styles.natInstaRow}>
                  <InstagramSlot raw={item.instagram} />
                </View>
              </View>
            )}
          />
        )}
        <View style={{ height: 28 }} />
      </View>
    ),
    [t, nationalRows, loading]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient colors={[Colors.primary, '#2E7D32']} style={styles.topBar}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('leaderboard')}</Text>
          <View style={{ width: 40 }} />
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>{t('leaderboard_loading')}</Text>
        </View>
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={async () => {
              setError(null);
              setLoading(true);
              await load();
              setLoading(false);
            }}
          >
            <Text style={styles.retryTxt}>{t('leaderboard_retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={restList}
          keyExtractor={(it) => `st-${it.profile_id}-${it.leader_rank}`}
          renderItem={({ item }) => <LeaderboardListRow item={item} />}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF', fontFamily: Colors.fontFamilyBold },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  loadingText: { marginTop: 12, color: Colors.textMuted, fontWeight: '600' },
  errorText: { color: Colors.error, textAlign: 'center', fontWeight: '600' },
  retryBtn: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: Colors.primary, borderRadius: 12 },
  retryTxt: { color: '#FFF', fontWeight: '800' },
  listContent: { paddingBottom: 24 },
  headerBlock: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: Colors.headerColor,
    fontFamily: Colors.fontFamilyBold,
    textAlign: 'center',
  },
  sectionSub: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: 4, fontWeight: '600' },
  podiumRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginTop: 20,
    paddingBottom: 8,
  },
  rewardsBtnWrapper: {
    marginVertical: 18,
    borderRadius: 15,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  rewardsGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  rewardsBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rewardsBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    marginLeft: 12,
  },
  podiumCol: { alignItems: 'center', paddingHorizontal: 4 },
  medalWrap: { marginBottom: 6 },
  podiumRing: {
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  podiumInner: { backgroundColor: '#FFF' },
  podiumImg: { backgroundColor: '#EEE' },
  avatarPh: { justifyContent: 'center', alignItems: 'center' },
  podiumName: { marginTop: 8, fontSize: 13, fontWeight: '800', color: Colors.headerColor, maxWidth: '100%', textAlign: 'center' },
  podiumNameMuted: { marginTop: 8, fontSize: 13, fontWeight: '700', color: Colors.textMuted },
  podiumPts: { marginTop: 4, fontSize: 12, fontWeight: '800', color: Colors.secondary },
  podiumPtsMuted: { marginTop: 4, fontSize: 12, fontWeight: '700', color: Colors.textMuted },
  listSectionTitle: {
    marginTop: 22,
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '900',
    color: Colors.headerColor,
  },
  emptyInline: { color: Colors.textMuted, textAlign: 'center', marginVertical: 12, paddingHorizontal: 12 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: Colors.cardBg,
    borderRadius: Colors.borderRadius,
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
  },
  listRank: { width: 36, fontSize: 16, fontWeight: '900', color: Colors.secondary, textAlign: 'center' },
  listAvatarWrap: { marginLeft: 4 },
  listAvatar: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden' },
  listMid: { flex: 1, marginLeft: 12, minWidth: 0 },
  listName: { fontSize: 15, fontWeight: '800', color: Colors.headerColor },
  listPointsSub: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, marginTop: 2 },
  instaSlot: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  footerBlock: { marginTop: 8, paddingTop: 8 },
  nationalBanner: {
    marginHorizontal: 12,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  nationalTitle: { color: '#FFF', fontSize: 16, fontWeight: '900', textAlign: 'center', fontFamily: Colors.fontFamilyBold },
  nationalSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, textAlign: 'center', marginTop: 4, fontWeight: '600' },
  natListContent: { paddingHorizontal: 12, paddingBottom: 8 },
  natCard: {
    width: 156,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 12,
    marginRight: 12,
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
    alignItems: 'center',
  },
  natRank: { fontSize: 13, fontWeight: '900', color: Colors.primary, marginBottom: 6 },
  natAvatar: { width: 64, height: 64, borderRadius: 32, marginBottom: 8 },
  natName: { fontSize: 13, fontWeight: '800', color: Colors.headerColor, textAlign: 'center', minHeight: 36 },
  natPts: { fontSize: 11, fontWeight: '800', color: Colors.secondary, marginTop: 4, textAlign: 'center' },
  natInstaRow: { marginTop: 6, minHeight: 36, justifyContent: 'center' },
});
