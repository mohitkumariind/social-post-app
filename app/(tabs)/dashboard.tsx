import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { downloadMediaToCache } from '../../lib/mediaCache';
import {
    ActivityIndicator,
    BackHandler,
    Dimensions,
    Modal,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { Colors } from '../../constants/Colors';
import { normalizePartyId } from '../../constants/Parties';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { supabase } from '../../lib/supabase';
import { EditProfileScreen } from '../edit-profile';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

/** Dashboard par aane + profile load ke baad, incomplete users ko itni der baad edit-profile modal */
const EDIT_PROFILE_GATE_DELAY_MS = 10_000;

/** Video thumbnail - expo-video on native, Image fallback on web (expo-video native driver issues). */
function VideoThumbnail({ uri, style }: { uri: string; style?: object }) {
  if (Platform.OS === 'web') {
    return <ExpoImage source={{ uri }} style={style} contentFit="cover" cachePolicy="disk" />;
  }
  const player = useVideoPlayer(uri, () => {});
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

const IMAGE_PLACEHOLDER_BLURHASH = 'LGFFaXYk^6#M@-5c,1J5@[or[Q6.';

interface Category {
  id: string;
  name: string;
  images: { url: string; shares: string; isVideo?: boolean; captions?: string }[];
}

type PostRow = { id: string; title: string; image_url: string; category: string; event_date?: string; is_video?: boolean; video_url?: string; party?: string[]; state?: string[]; captions?: string | string[] };

/** `posts.captions` may be TEXT (JSON string) or jsonb array from Supabase. */
function postCaptionsForNavigation(c: string | string[] | null | undefined): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return JSON.stringify(c);
  return '';
}
type EventRow = { name: string; end: string };

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

/** Align with edit-profile mandatory fields + party selection */
function isProfileIncomplete(info: { name: string; phone: string; state: string; partyName: string }): boolean {
  const nameOk = (info.name ?? '').trim().length > 0;
  const phoneOk = (info.phone ?? '').trim().length > 0;
  const stateOk = (info.state ?? '').trim().length > 0;
  const partyOk = (info.partyName ?? '').trim().length > 0;
  return !nameOk || !phoneOk || !stateOk || !partyOk;
}

export default function DashboardScreen() {
  const router = useRouter();
  const dashParams = useLocalSearchParams();
  const { userInfo, setUserInfo } = useUser();
  const { t, lang } = useLang();
  const [activeTab, setActiveTab] = useState('graphics');
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const categoryCarouselRef = useRef<ScrollView>(null);
  const trendingRef = useRef<ScrollView>(null);
  const hasFetchedProfileRef = useRef(false);
  const [authReady, setAuthReady] = useState(false);
  const [dashboardProfileLoaded, setDashboardProfileLoaded] = useState(false);
  const [editProfileDelayedVisible, setEditProfileDelayedVisible] = useState(false);
  const userInfoRef = useRef(userInfo);
  const consumedExpandKeyRef = useRef<string>('');
  userInfoRef.current = userInfo;

  const [dailyLocalByUrl, setDailyLocalByUrl] = useState<Record<string, string>>({});
  const dailyInFlightRef = useRef<Set<string>>(new Set());

  const ensureDailyCached = React.useCallback(
    async (url: string) => {
      const u = String(url ?? '').trim();
      if (!u) return;
      if (dailyLocalByUrl[u]) return;
      if (dailyInFlightRef.current.has(u)) return;
      dailyInFlightRef.current.add(u);
      try {
        const local = await downloadMediaToCache({ kind: 'daily', url: u });
        if (local) {
          setDailyLocalByUrl((prev) => (prev[u] ? prev : { ...prev, [u]: local }));
        }
      } finally {
        dailyInFlightRef.current.delete(u);
      }
    },
    [dailyLocalByUrl]
  );

  /** Fetch user state & party from profiles table. Runs only after auth is ready. */
  const fetchUserProfile = React.useCallback(async () => {
    try {
      await supabase.auth.refreshSession();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id ?? null;
      if (!userId) return { state: '', party: '' };

      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'state, district, constituency, loksabha_id, assembly_id, party, name, phone, avatar_url'
        )
        .eq('id', userId)
        .single();

      if (profile) {
        const rawParty = String(profile.party ?? '').trim();
        const party = normalizePartyId(rawParty) || rawParty;
        const stateStr = String(profile.state ?? '').trim();
        const nameFromDb = String(profile.name ?? '').trim();
        const phoneFromDb = String(profile.phone ?? '').trim();
        const avatarUrl = String((profile as { avatar_url?: string }).avatar_url ?? '').trim();
        setUserInfo((prev) => ({
          ...prev,
          name: nameFromDb,
          phone: phoneFromDb,
          state: stateStr || prev.state,
          district: String(profile.district ?? prev.district ?? ''),
          constituency: String(profile.constituency ?? prev.constituency ?? ''),
          loksabha_id: profile.loksabha_id ?? prev.loksabha_id,
          assembly_id: profile.assembly_id ?? prev.assembly_id,
          partyName: party || prev.partyName,
          avatar_url: avatarUrl,
        }));
        return { state: stateStr, party };
      }
    } catch (e) {
      if (__DEV__) console.error('fetchUserProfile failed');
    }
    return { state: '', party: '' };
  }, [setUserInfo]);

  const fetchPosts = React.useCallback(async (userState: string, userParty: string, silent = false) => {
    try {
      if (!silent) {
        setFetchError(null);
        setLoading(true);
      }
      // No server-side .or() / .cs. filters here — they caused PGRST100 (parse filter) with some values.
      // Filter by state/party in memory below (same behavior, safe PostgREST URL).
      const query = supabase
        .from('posts')
        .select('id,title,image_url,video_url,is_video,category,event_date,party,state,created_at,captions')
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) {
        setFetchError(error.message);
        // Full PostgREST error (RLS / missing table / bad filter) — visible in Metro / Logcat for APK debugging
        console.warn('[Dashboard fetchPosts] Supabase error:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        if (__DEV__) console.warn('[Dashboard fetchPosts] raw error object:', error);
        setPosts([]);
        return;
      }
      const raw = (data || []) as PostRow[];
      const normalizedUserState = normalizeForCompare(userState || '');
      const normalizedUserParty = normalizeForCompare(normalizePartyId(userParty || '') || userParty || '');
      const filtered = raw.filter((p) => {
        const postStates = Array.isArray(p.state) ? p.state : (p.state ? [p.state] : []);
        const postParties = Array.isArray(p.party) ? p.party : (p.party ? [p.party] : []);

        const normalizedPostStates = postStates.map((s) => normalizeForCompare(String(s)));
        const normalizedPostParties = postParties.map((pa) =>
          normalizeForCompare(normalizePartyId(String(pa)) || String(pa))
        );

        const stateMatch =
          normalizedPostStates.length === 0 ||
          !normalizedUserState ||
          normalizedPostStates.includes(normalizedUserState);
        const partyMatch =
          normalizedPostParties.length === 0 ||
          !normalizedUserParty ||
          normalizedPostParties.includes(normalizedUserParty);
        return stateMatch && partyMatch;
      });
      const finalPosts = filtered.length > 0 ? filtered : raw;
      if (__DEV__) {
        console.log('[Dashboard fetchPosts] filter stats', {
          rawCount: raw.length,
          filteredCount: filtered.length,
          finalCount: finalPosts.length,
          userState,
          userParty,
          normalizedUserState,
          normalizedUserParty,
        });
      }
      setPosts(finalPosts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(msg);
      console.warn('[Dashboard fetchPosts] exception:', err);
      setPosts([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchEvents = async () => {
    const { data } = await supabase.from('events').select('name, end');
    const raw = (data as EventRow[]) || [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const filteredEvents = raw.filter((ev) => {
      const evEndDate = new Date(ev.end);
      evEndDate.setUTCHours(0, 0, 0, 0);
      return evEndDate.getTime() >= today.getTime();
    });
    setEvents(filteredEvents);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await supabase.auth.getSession();
      if (cancelled) return;
      setAuthReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      if (refreshKey === 0 && !hasFetchedProfileRef.current) {
        hasFetchedProfileRef.current = true;
        const { state, party } = await fetchUserProfile() as { state: string; party: string };
        if (cancelled) return;
        await fetchPosts(state, party);
      } else {
        const state = (userInfo?.state ?? '').trim();
        const party = (userInfo?.partyName ?? '').trim();
        await fetchPosts(state, party);
      }
      if (!cancelled) setDashboardProfileLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [authReady, refreshKey, userInfo?.state, userInfo?.partyName, fetchUserProfile, fetchPosts]);

  useEffect(() => {
    if (!authReady || !dashboardProfileLoaded) {
      setEditProfileDelayedVisible(false);
      return;
    }
    if (!isProfileIncomplete(userInfo)) {
      setEditProfileDelayedVisible(false);
      return;
    }
    const t = setTimeout(() => {
      if (isProfileIncomplete(userInfoRef.current)) {
        setEditProfileDelayedVisible(true);
      }
    }, EDIT_PROFILE_GATE_DELAY_MS);
    return () => clearTimeout(t);
  }, [
    authReady,
    dashboardProfileLoaded,
    userInfo.name,
    userInfo.phone,
    userInfo.state,
    userInfo.partyName,
  ]);

  const showEditProfileModal =
    editProfileDelayedVisible && authReady && dashboardProfileLoaded && isProfileIncomplete(userInfo);

  const handleProfileSaved = React.useCallback(() => {
    void fetchUserProfile();
    setRefreshKey((p) => p + 1);
  }, [fetchUserProfile]);

  useEffect(() => {
    fetchEvents();
    const channel = supabase
      .channel('realtime-any')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => setRefreshKey((p) => p + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => setRefreshKey((p) => p + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /** Posts are already filtered by user state/party in fetchPosts */
  const filteredPosts = posts;

  const postsByCategory = React.useMemo(() => {
    const map = new Map<string, Category>();
    for (const p of filteredPosts) {
      if (!p.image_url || p.is_video) continue;
      const catName = p.category || 'Latest';
      const catId = catName.toLowerCase().replace(/\s+/g, '-');
      if (!map.has(catId)) {
        map.set(catId, { id: catId, name: catName, images: [] });
      }
      map.get(catId)!.images.push({
        url: p.image_url,
        shares: '0',
        isVideo: false,
        captions: postCaptionsForNavigation(p.captions),
      });
    }
    return Array.from(map.values());
  }, [filteredPosts, refreshKey]);

  const reelsByCategory = React.useMemo(() => {
    const map = new Map<string, Category>();
    for (const p of filteredPosts) {
      if (!(p.is_video && (p.video_url || p.image_url))) continue;
      const catName = p.category || 'Latest';
      const catId = catName.toLowerCase().replace(/\s+/g, '-');
      if (!map.has(catId)) {
        map.set(catId, { id: catId, name: catName, images: [] });
      }
      map.get(catId)!.images.push({
        url: p.video_url || p.image_url || '',
        shares: '0',
        isVideo: true,
        captions: postCaptionsForNavigation(p.captions),
      });
    }
    return Array.from(map.values());
  }, [filteredPosts, refreshKey]);

  const graphicsData = React.useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (events.length === 0) return postsByCategory;
    const activeEventNames = new Set(events.map((e) => e.name));
    const eventEndByName = new Map(events.map((e) => [e.name, e.end]));
    const filtered = postsByCategory.filter((cat) => {
      if (!activeEventNames.has(cat.name)) return false;
      const evEnd = eventEndByName.get(cat.name);
      if (!evEnd) return false;
      const evEndDate = new Date(evEnd);
      evEndDate.setUTCHours(0, 0, 0, 0);
      return evEndDate.getTime() >= today.getTime();
    });
    const result = filtered.length === 0 ? [] : filtered.sort((a, b) => {
      const endA = eventEndByName.get(a.name);
      const endB = eventEndByName.get(b.name);
      if (!endA || !endB) return 0;
      return new Date(endA).getTime() - new Date(endB).getTime();
    });
    // If event-name mapping is out of sync with post category names, do not blank dashboard.
    return result.length > 0 ? result : postsByCategory;
  }, [postsByCategory, events, refreshKey]);

  const reelsData = React.useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (events.length === 0) return reelsByCategory;
    const activeEventNames = new Set(events.map((e) => e.name));
    const eventEndByName = new Map(events.map((e) => [e.name, e.end]));
    const filtered = reelsByCategory.filter((cat) => {
      if (!activeEventNames.has(cat.name)) return false;
      const evEnd = eventEndByName.get(cat.name);
      if (!evEnd) return false;
      const evEndDate = new Date(evEnd);
      evEndDate.setUTCHours(0, 0, 0, 0);
      return evEndDate.getTime() >= today.getTime();
    });
    const result = filtered.length === 0 ? [] : filtered.sort((a, b) => {
      const endA = eventEndByName.get(a.name);
      const endB = eventEndByName.get(b.name);
      if (!endA || !endB) return 0;
      return new Date(endA).getTime() - new Date(endB).getTime();
    });
    return result.length > 0 ? result : reelsByCategory;
  }, [reelsByCategory, events, refreshKey]);

  const CURRENT_DATA = activeTab === 'graphics' ? graphicsData : reelsData;
  // Captions now come from `posts.captions` only (not events).

  useEffect(() => {
    const itemWidth = 140 + 15;
    const initialOffset = itemWidth * CURRENT_DATA.length;
    trendingRef.current?.scrollTo({ x: initialOffset, animated: false });
  }, [activeTab, lang]);

  const allTrending = useMemo(() => {
    return CURRENT_DATA
      .filter((cat) => cat.images.length > 0)
      .map((cat) => ({ ...cat.images[0], catSource: cat }));
  }, [CURRENT_DATA, lang]);

  const infiniteTrendingData = useMemo(() => {
    return [...allTrending, ...allTrending, ...allTrending];
  }, [allTrending, lang]);

  const handleTrendingScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const itemWidth = 140 + 15;
    const totalSetWidth = itemWidth * allTrending.length;
    if (totalSetWidth === 0) return;
    if (offsetX >= totalSetWidth * 2) {
      trendingRef.current?.scrollTo({ x: offsetX - totalSetWidth, animated: false });
    } else if (offsetX <= 5) {
      trendingRef.current?.scrollTo({ x: offsetX + totalSetWidth, animated: false });
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setActiveCategory(null);
  };

  const switchCategory = (cat: Category | null, index: number) => {
    if (cat === null) {
      setActiveCategory(null);
    } else {
      setActiveCategory(cat);
      setTimeout(() => {
        categoryCarouselRef.current?.scrollTo({ x: (index + 1) * width, animated: false });
      }, 50);
    }
  };

  const handleGridScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    if (index === 0 && activeCategory !== null) {
      setActiveCategory(null);
      return;
    }
    const catIndex = index - 1;
    if (CURRENT_DATA[catIndex] && activeCategory?.id !== CURRENT_DATA[catIndex].id) {
      setActiveCategory(CURRENT_DATA[catIndex]);
    }
  };

  useEffect(() => {
    const tabParamRaw = dashParams?.expandTab;
    const tabParam = typeof tabParamRaw === 'string' ? tabParamRaw : Array.isArray(tabParamRaw) ? tabParamRaw[0] : undefined;
    if (tabParam === 'graphics' || tabParam === 'reels') {
      setActiveTab(tabParam);
    }
  }, [dashParams?.expandTab]);

  useEffect(() => {
    const catParamRaw = dashParams?.expandCategory;
    const expandCategory = typeof catParamRaw === 'string' ? catParamRaw : Array.isArray(catParamRaw) ? catParamRaw[0] : undefined;
    if (!expandCategory || CURRENT_DATA.length === 0) return;
    const tabParamRaw = dashParams?.expandTab;
    const tabParam = typeof tabParamRaw === 'string' ? tabParamRaw : Array.isArray(tabParamRaw) ? tabParamRaw[0] : '';
    const expandKey = `${tabParam}::${expandCategory}`;
    if (consumedExpandKeyRef.current === expandKey) return;
    const idx = CURRENT_DATA.findIndex((c) => c.name === expandCategory);
    if (idx === -1) return;
    const target = CURRENT_DATA[idx];
    if (activeCategory?.id === target.id) return;
    consumedExpandKeyRef.current = expandKey;
    switchCategory(target, idx);
    // Clear route params after one-time restore so next back press can collapse/exit normally.
    router.setParams({ expandCategory: undefined, expandTab: undefined });
  }, [dashParams?.expandCategory, dashParams?.expandTab, CURRENT_DATA, activeCategory, router]);

  useEffect(() => {
    const onBackPress = () => {
      if (activeCategory) {
        setActiveCategory(null);
        router.setParams({ expandCategory: undefined, expandTab: undefined });
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [activeCategory, router]);

  const renderTabs = () => (
    <View style={styles.tabContainer}>
      <TouchableOpacity style={[styles.tabButton, activeTab === 'graphics' && styles.activeTab]} onPress={() => handleTabChange('graphics')}>
        <Ionicons name="image" size={18} color={activeTab === 'graphics' ? '#FFF' : Colors.primary} />
        <Text style={[styles.tabText, activeTab === 'graphics' && styles.activeTabText]}>{t('graphics')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.tabButton, activeTab === 'reels' && styles.activeTab]} onPress={() => handleTabChange('reels')}>
        <Ionicons name="play-circle" size={18} color={activeTab === 'reels' ? '#FFF' : Colors.primary} />
        <Text style={[styles.tabText, activeTab === 'reels' && styles.activeTabText]}>{t('reels')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderTrendingSection = () => (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{activeTab === 'graphics' ? `Trending ${t('graphics')}` : `Trending ${t('reels')}`}</Text>
        {activeCategory && (
          <TouchableOpacity onPress={() => setActiveCategory(null)} style={styles.backLink}>
            <Text style={styles.backLinkText}>{t('explore_all')} 🚀</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        ref={trendingRef} horizontal showsHorizontalScrollIndicator={false}
        onScroll={handleTrendingScroll} scrollEventThrottle={16}
        contentContainerStyle={{ paddingLeft: 20 }}
      >
      {infiniteTrendingData.map((item, index) => (
        <TouchableOpacity key={index} style={[styles.trendingItem, { height: activeTab === 'graphics' ? Math.round(140 * 5 / 4) : Math.round(140 * 16 / 9) }]} onPress={() => switchCategory(item.catSource, index % allTrending.length)}>
          {item.isVideo ? (
            <VideoThumbnail uri={item.url} style={styles.postImage} />
          ) : (
            <ExpoImage
              source={{ uri: dailyLocalByUrl[item.url] || item.url }}
              style={styles.postImage}
              contentFit="contain"
              cachePolicy="disk"
              placeholder={{ blurhash: IMAGE_PLACEHOLDER_BLURHASH }}
              transition={200}
              onLoadStart={() => void ensureDailyCached(item.url)}
            />
          )}
          {item.isVideo && <View style={styles.playIconOverlay}><Ionicons name="play-outline" size={28} color="#FFF" /></View>}
          <View style={styles.catLabelBadge}><Text style={styles.catLabelText}>{item.catSource.name}</Text></View>
        </TouchableOpacity>
      ))}
    </ScrollView>
    </View>
  );

  const renderHomeRows = () => (
    <View style={{ paddingBottom: 30 }}>
      {renderTrendingSection()}
      {CURRENT_DATA.map((cat, idx) => (
        <View key={cat.id} style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{cat.name}</Text>
            <TouchableOpacity onPress={() => switchCategory(cat, idx)}>
              <Text style={styles.viewAllText}>{t('view_all') || 'View All'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.postGridRow}>
            {cat.images.slice(0, 2).map((img, index) => (
              <TouchableOpacity
                key={index} style={[styles.postItem, { height: activeTab === 'graphics' ? Math.round((width - 55) / 2 * 5 / 4) : Math.round((width - 55) / 2 * 16 / 9) }]}
                onPress={() => switchCategory(cat, idx)}
              >
                {img.isVideo ? (
                  <VideoThumbnail uri={img.url} style={styles.postImage} />
                ) : (
                  <ExpoImage
                    source={{ uri: dailyLocalByUrl[img.url] || img.url }}
                    style={styles.postImage}
                    contentFit="contain"
                    cachePolicy="disk"
                    placeholder={{ blurhash: IMAGE_PLACEHOLDER_BLURHASH }}
                    transition={200}
                    onLoadStart={() => void ensureDailyCached(img.url)}
                  />
                )}
                {img.isVideo && <View style={styles.playIconOverlay}><Ionicons name="play-outline" size={28} color="#FFF" /></View>}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </View>
  );

  const renderSlidingGrids = () => (
    <View style={{ marginTop: 10, paddingBottom: 30 }}>
      {renderTrendingSection()}
      <ScrollView
        ref={categoryCarouselRef} horizontal pagingEnabled
        showsHorizontalScrollIndicator={false} onScroll={handleGridScroll} scrollEventThrottle={16}
      >
        <View style={{ width: width, justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity style={styles.allTrendingBackCard} onPress={() => setActiveCategory(null)}>
            <LinearGradient colors={[Colors.primary, Colors.accent]} style={styles.allTrendingGradient}>
              <Ionicons name={activeTab === 'graphics' ? "apps" : "videocam"} size={50} color="#FFF" />
              <Text style={styles.allTrendingTitle}>{activeTab === 'graphics' ? `All ${t('graphics')}` : `All ${t('reels')}`}</Text>
              <Text style={styles.allTrendingSub}>{t('tap_see_categories')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
        {CURRENT_DATA.map((cat) => (
          <View key={cat.id} style={{ width: width }}>
            <View style={styles.gridSectionHeader}>
              <Text style={styles.gridSectionTitle}>{cat.name}</Text>
              <Text style={styles.gridSectionSub}>{t('swipe_left_back')}</Text>
            </View>
            <View style={styles.staggeredContainer}>
              {cat.images.map((img, idx) => (
                <TouchableOpacity
                  key={idx} style={[styles.modernGridItem, { height: activeTab === 'graphics' ? Math.round((width - 50) / 2 * 5 / 4) : Math.round((width - 50) / 2 * 16 / 9), marginTop: idx % 2 === 0 ? 0 : 25 }]}
                  onPress={() => router.push({
                    pathname: '/(auth)/post-detail',
                    params: {
                      isVideo: img.isVideo ? 'true' : 'false',
                      aspectRatio: activeTab === 'reels' ? '9:16' : '4:5',
                      image: img.url,
                      images: JSON.stringify(cat.images.map(i => i.url)),
                      currentIndex: idx,
                      category: cat.name,
                      captions: img.captions || '',
                      fromTab: activeTab
                    }
                  })}
                >
                  {img.isVideo ? (
                    <VideoThumbnail uri={img.url} style={styles.modernGridImg} />
                  ) : (
                    <ExpoImage
                      source={{ uri: dailyLocalByUrl[img.url] || img.url }}
                      style={styles.modernGridImg}
                      contentFit="contain"
                      cachePolicy="disk"
                      placeholder={{ blurhash: IMAGE_PLACEHOLDER_BLURHASH }}
                      transition={200}
                      onLoadStart={() => void ensureDailyCached(img.url)}
                    />
                  )}
                  {img.isVideo && <View style={styles.playIconOverlay}><Ionicons name="play-outline" size={32} color="#FFF" /></View>}
                  <View style={styles.modernShareLabel}>
                    <Ionicons name="flame" size={10} color="#FFD700" />
                    <Text style={styles.modernShareText}>{img.shares}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <>
      <Modal
        visible={showEditProfileModal}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {}}
      >
        <EditProfileScreen embedMode isVisible={showEditProfileModal} onSaved={handleProfileSaved} />
      </Modal>

      <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/profile')} style={styles.profileRow}>
          <View style={styles.avatarPlaceholder}>
            {userInfo?.avatar_url ? (
              <ExpoImage
                source={{ uri: userInfo.avatar_url }}
                style={{ width: 45, height: 45, borderRadius: 22.5 }}
                contentFit="cover"
                cachePolicy="disk"
                placeholder={{ blurhash: IMAGE_PLACEHOLDER_BLURHASH }}
                transition={200}
              />
            ) : (
              <Ionicons name="person" size={24} color={Colors.accent} />
            )}
          </View>
          <View style={styles.welcomeTextGroup}>
            <Text style={styles.welcomeText}>{t('welcome')}!</Text>
            <Text style={styles.userName}>{t('hi_user')}, {userInfo?.name?.split(' ')[0] || t('user')}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/language', params: { next: '/dashboard' } })}
            style={styles.langBtn}
            activeOpacity={0.7}
          >
            <View style={styles.langIconCircle}>
              <MaterialIcons name="translate" size={18} color={Colors.accent} />
            </View>
            <Text style={styles.langCode}>{(lang || 'en').toUpperCase()}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/notifications')}
            style={styles.headerIconBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="notifications-outline" size={28} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
        {renderTabs()}

        <View style={styles.gradientHeaderWrapper}>
          <LinearGradient colors={[Colors.primary, Colors.accent]} style={styles.eclipseGradient}>
            <Text style={styles.modernCenterTitle}>
              {activeCategory ? activeCategory.name : (activeTab === 'graphics' ? `Top Picks ${t('graphics')}` : `Top Picks ${t('reels')}`)}
            </Text>
          </LinearGradient>
        </View>

        {loading ? (
          <View style={styles.statusMessage}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={[styles.statusText, { marginTop: 12 }]}>Loading...</Text>
          </View>
        ) : fetchError ? (
          <View style={styles.statusMessage}>
            <Text style={styles.statusError}>Error: {fetchError}</Text>
            <TouchableOpacity
              onPress={() =>
                fetchPosts((userInfo?.state ?? '').trim(), (userInfo?.partyName ?? '').trim())
              }
              style={styles.retryButton}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filteredPosts.length === 0 ||
          (activeTab === 'graphics' && graphicsData.length === 0) ||
          (activeTab === 'reels' && reelsData.length === 0) ? null : (
          activeCategory ? renderSlidingGrids() : renderHomeRows()
        )}
      </ScrollView>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingTop: Platform.OS === 'android' ? 40 : 10, paddingHorizontal: 25, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerIconBtn: { paddingLeft: 14 },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(138, 43, 226, 0.08)',
  },
  langIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(142, 36, 170, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langCode: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '900',
    color: Colors.accent,
    letterSpacing: 0.5,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  avatarPlaceholder: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#E8EAF6', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  welcomeTextGroup: { marginLeft: 12 },
  welcomeText: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' },
  userName: { fontSize: 18, fontWeight: '800', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  tabContainer: { flexDirection: 'row', marginHorizontal: 24, marginVertical: 16, backgroundColor: Colors.cardBg, borderRadius: Colors.borderRadius, padding: 6, ...Colors.cardShadow, elevation: Colors.cardElevation },
  tabButton: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderRadius: Colors.borderRadiusSm, gap: 8 },
  activeTab: { backgroundColor: Colors.primary },
  tabText: { fontWeight: '700', color: Colors.primary, fontSize: 14 },
  activeTabText: { color: '#FFF' },
  gradientHeaderWrapper: { height: 60, marginVertical: 10, paddingHorizontal: 20 },
  eclipseGradient: { height: 50, width: '100%', borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  modernCenterTitle: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  sectionContainer: { marginTop: 25 },
  sectionHeader: { paddingHorizontal: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  viewAllText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  backLink: { backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  backLinkText: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
  trendingItem: { width: 140, borderRadius: Colors.borderRadius, overflow: 'hidden', marginRight: 15, backgroundColor: Colors.cardBg, ...Colors.cardShadow, elevation: Colors.cardElevation },
  postGridRow: { flexDirection: 'row', paddingHorizontal: 20, justifyContent: 'space-between' },
  postItem: { width: (width - 55) / 2, borderRadius: Colors.borderRadius, overflow: 'hidden', backgroundColor: Colors.cardBg, ...Colors.cardShadow, elevation: Colors.cardElevation },
  postImage: { width: '100%', height: '100%', backgroundColor: Colors.borderLight },
  playIconOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.15)' },
  catLabelBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(142, 36, 170, 0.9)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, elevation: 3 },
  catLabelText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  gridSectionHeader: { paddingHorizontal: 25, marginBottom: 15, marginTop: 10 },
  gridSectionTitle: { fontSize: 22, fontWeight: '900', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  gridSectionSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  allTrendingBackCard: { width: width - 80, height: 350, borderRadius: 12, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8 },
  allTrendingGradient: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 15 },
  allTrendingTitle: { color: '#FFF', fontSize: 28, fontWeight: '900' },
  allTrendingSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
  staggeredContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 15, paddingBottom: 50 },
  modernGridItem: { width: (width - 50) / 2, borderRadius: Colors.borderRadius, overflow: 'hidden', backgroundColor: Colors.cardBg, ...Colors.cardShadow, elevation: Colors.cardElevation },
  modernGridImg: { width: '100%', height: '100%' },
  modernShareLabel: { position: 'absolute', bottom: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  modernShareText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  statusMessage: { paddingVertical: 40, paddingHorizontal: 25, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontSize: 16, fontWeight: '700', color: Colors.textMuted },
  statusError: { fontSize: 14, fontWeight: '600', color: Colors.error, textAlign: 'center' },
  retryButton: { marginTop: 20, paddingVertical: 14, paddingHorizontal: 28, backgroundColor: Colors.primary, borderRadius: 12 },
  retryButtonText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});
