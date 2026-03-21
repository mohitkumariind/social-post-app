import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Image,
    Modal,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    SafeAreaView,
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

/** State selection popup translations by ui_language */
const STATE_POPUP_TRANSLATIONS: Record<string, { title: string; button: string; subtitle?: string }> = {
  en: { title: 'Select Your State', button: 'Proceed', subtitle: 'Please select your state to continue.' },
  hi: { title: 'अपना राज्य चुनें', button: 'आगे बढ़ें', subtitle: 'जारी रखने के लिए अपना राज्य चुनें।' },
  pa: { title: 'ਆਪਣਾ ਰਾਜ ਚੁਣੋ', button: 'ਅੱਗੇ ਵਧੋ', subtitle: 'ਜਾਰੀ ਰੱਖਣ ਲਈ ਆਪਣਾ ਰਾਜ ਚੁਣੋ।' },
  mr: { title: 'तुमचा राज्य निवडा', button: 'पुढे जा', subtitle: 'सुरू ठेवण्यासाठी तुमचा राज्य निवडा।' },
  gu: { title: 'તમારું રાજ્ય પસંદ કરો', button: 'આગળ વધો', subtitle: 'ચાલુ રાખવા માટે તમારું રાજ્ય પસંદ કરો।' },
};

const { width } = Dimensions.get('window');

/** Video thumbnail - expo-video on native, Image fallback on web (expo-video native driver issues). */
function VideoThumbnail({ uri, style }: { uri: string; style?: object }) {
  if (Platform.OS === 'web') {
    return <Image source={{ uri }} style={style} resizeMode="cover" />;
  }
  const player = useVideoPlayer(uri, () => {});
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

interface Category {
  id: string;
  name: string;
  images: { url: string; shares: string; isVideo?: boolean }[];
}

type PostRow = { id: string; title: string; image_url: string; category: string; event_date?: string; is_video?: boolean; video_url?: string; party?: string[]; state?: string[] };

const PROFILE_REDIRECT_DONE_KEY = '@profile_redirect_done';

/** Align with edit-profile mandatory fields + party selection */
function isProfileIncomplete(info: { name: string; phone: string; state_id: number | null; partyName: string }, mustPickState: boolean): boolean {
  if (mustPickState) return true;
  const nameOk = (info.name ?? '').trim().length > 0;
  const phoneOk = (info.phone ?? '').trim().length > 0;
  const stateOk = info.state_id != null;
  const partyOk = (info.partyName ?? '').trim().length > 0;
  return !nameOk || !phoneOk || !stateOk || !partyOk;
}

export default function DashboardScreen() {
  const router = useRouter();
  const { userInfo, setUserInfo } = useUser();
  const { t, lang } = useLang();
  const [activeTab, setActiveTab] = useState('graphics');
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [events, setEvents] = useState<{ name: string; end: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [mustSelectState, setMustSelectState] = useState(false);
  const [selectedStateId, setSelectedStateId] = useState<number | null>(null);
  const [availableStates, setAvailableStates] = useState<{ id: number; name: string }[]>([]);
  const [stateSaving, setStateSaving] = useState(false);

  const categoryCarouselRef = useRef<ScrollView>(null);
  const trendingRef = useRef<ScrollView>(null);
  const hasFetchedProfileRef = useRef(false);
  const [authReady, setAuthReady] = useState(false);
  const [dashboardProfileLoaded, setDashboardProfileLoaded] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const userInfoRef = useRef(userInfo);
  userInfoRef.current = userInfo;
  const mustSelectStateRef = useRef(mustSelectState);
  mustSelectStateRef.current = mustSelectState;

  const langKey = (lang || 'en').toLowerCase().slice(0, 2);
  const stateT = STATE_POPUP_TRANSLATIONS[langKey] ?? STATE_POPUP_TRANSLATIONS.en;

  /** Fetch user state & party from profiles table. Runs only after auth is ready. */
  const fetchUserProfile = React.useCallback(async () => {
    try {
      await supabase.auth.refreshSession();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id ?? null;
      if (!userId) return { state: '', party: '' };

      userIdRef.current = userId;
      const { data: profile } = await supabase
        .from('profiles')
        .select('state, state_id, loksabha_id, assembly_id, party, party_name, name, full_name, phone')
        .eq('id', userId)
        .single();

      if (profile) {
        const rawParty = String(profile.party ?? profile.party_name ?? '').trim();
        const party = normalizePartyId(rawParty) || rawParty;
        const stateId = profile.state_id != null ? profile.state_id : null;
        const nameFromDb = String(profile.full_name ?? profile.name ?? '').trim();
        const phoneFromDb = String(profile.phone ?? '').trim();
        setUserInfo((prev) => ({
          ...prev,
          name: nameFromDb,
          phone: phoneFromDb,
          state_id: stateId ?? prev.state_id,
          loksabha_id: profile.loksabha_id ?? prev.loksabha_id,
          assembly_id: profile.assembly_id ?? prev.assembly_id,
          partyName: party || prev.partyName,
        }));
        if (stateId == null && !profile.state) setMustSelectState(true);
        return { state: stateId != null ? String(stateId) : String(profile.state ?? ''), party };
      }
      setMustSelectState(true);
    } catch (e) {
      if (__DEV__) console.error('fetchUserProfile failed');
      setMustSelectState(true);
    }
    return { state: '', party: '' };
  }, [setUserInfo]);

  const fetchPosts = React.useCallback(async (userState: string, userParty: string, silent = false) => {
    try {
      if (!silent) {
        setFetchError(null);
        setLoading(true);
      }
      let query = supabase.from('posts').select('*').order('created_at', { ascending: false });

      try {
        if (userState) {
          const esc = userState.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          query = query.or(`state.is.null,state.cs.{"${esc}"}`);
        }
        if (userParty) {
          const esc = userParty.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          query = query.or(`party.is.null,party.cs.{"${esc}"}`);
        }
      } catch (_) {}

      const { data, error } = await query;
      if (error) {
        setFetchError(error.message);
        if (__DEV__) console.error('Dashboard fetchPosts error');
        setPosts([]);
        return;
      }
      const raw = (data || []) as PostRow[];
      const filtered = raw.filter((p) => {
        const postStates = Array.isArray(p.state) ? p.state : (p.state ? [p.state] : []);
        const postParties = Array.isArray(p.party) ? p.party : (p.party ? [p.party] : []);
        const stateMatch = postStates.length === 0 || !userState || postStates.some((s) => String(s).trim() === userState);
        const partyMatch = postParties.length === 0 || !userParty || postParties.some((pa) => String(pa).trim() === userParty);
        return stateMatch && partyMatch;
      });
      setPosts(filtered);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(msg);
      if (__DEV__) console.error('Dashboard fetchPosts exception');
      setPosts([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchEvents = async () => {
    const { data } = await supabase.from('events').select('name, end');
    const raw = (data as { name: string; end: string }[]) || [];
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
    if (mustSelectState) {
      setSelectedStateId(userInfo?.state_id ?? null);
      supabase.from('states').select('*').then(({ data }) => {
        if (data) setAvailableStates(data.map((r: { id: number; name: string }) => ({ id: r.id, name: r.name })));
      });
    }
  }, [mustSelectState, userInfo?.state_id]);

  const handleStateProceed = async () => {
    if (selectedStateId == null || stateSaving) return;
    setStateSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      let userId = sessionData?.session?.user?.id ?? null;
      if (!userId) {
        const { data: userData } = await supabase.auth.getUser();
        userId = userData?.user?.id ?? null;
      }
      if (!userId) userId = userIdRef.current;
      if (!userId) {
        if (__DEV__) console.error('[State Save] No logged-in user');
        setStateSaving(false);
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ state_id: selectedStateId })
        .eq('id', userId);

      if (error) {
        if (__DEV__) console.error('[State Save] profiles update error');
        setStateSaving(false);
        return;
      }

      setUserInfo((prev) => ({ ...prev, state_id: selectedStateId }));
      setMustSelectState(false);
      setRefreshKey((p) => p + 1);
      if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
        window.location.reload();
      }
    } catch (e) {
      if (__DEV__) console.error('[State Save] Exception');
    } finally {
      setStateSaving(false);
    }
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
        const state = userInfo?.state_id != null ? String(userInfo.state_id) : '';
        const party = (userInfo?.partyName ?? '').trim();
        await fetchPosts(state, party);
      }
      if (!cancelled) setDashboardProfileLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [authReady, refreshKey, userInfo?.state_id, userInfo?.partyName, fetchUserProfile, fetchPosts]);

  /** After profile is synced from Supabase, optionally auto-open edit-profile for incomplete users (once). */
  useEffect(() => {
    if (!authReady || !dashboardProfileLoaded) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    (async () => {
      try {
        const done = await AsyncStorage.getItem(PROFILE_REDIRECT_DONE_KEY);
        if (cancelled || done === 'true') return;
        if (!isProfileIncomplete(userInfoRef.current, mustSelectStateRef.current)) return;

        timeoutId = setTimeout(async () => {
          if (cancelled) return;
          try {
            const again = await AsyncStorage.getItem(PROFILE_REDIRECT_DONE_KEY);
            if (again === 'true') return;
            if (!isProfileIncomplete(userInfoRef.current, mustSelectStateRef.current)) return;
            router.push('/edit-profile');
          } catch {
            /* ignore */
          }
        }, 10_000);
      } catch {
        /* ignore AsyncStorage */
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [authReady, dashboardProfileLoaded, router]);

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
      map.get(catId)!.images.push({ url: p.image_url, shares: '0', isVideo: false });
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
      map.get(catId)!.images.push({ url: p.video_url || p.image_url || '', shares: '0', isVideo: true });
    }
    return Array.from(map.values());
  }, [filteredPosts, refreshKey]);

  const graphicsData = React.useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
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
    return result;
  }, [postsByCategory, events, refreshKey]);

  const reelsData = React.useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
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
    return result;
  }, [reelsByCategory, events, refreshKey]);

  const CURRENT_DATA = activeTab === 'graphics' ? graphicsData : reelsData;

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
            <Image source={{ uri: item.url }} style={styles.postImage} resizeMode="contain" />
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
                onPress={() => router.push({ pathname: '/(auth)/post-detail', params: { isVideo: img.isVideo ? 'true' : 'false', aspectRatio: activeTab === 'reels' ? '9:16' : '4:5', image: img.url, images: JSON.stringify(cat.images.map(i => i.url)), currentIndex: index, category: cat.name } })}
              >
                {img.isVideo ? (
                  <VideoThumbnail uri={img.url} style={styles.postImage} />
                ) : (
                  <Image source={{ uri: img.url }} style={styles.postImage} resizeMode="contain" />
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
                    params: { isVideo: img.isVideo ? 'true' : 'false', aspectRatio: activeTab === 'reels' ? '9:16' : '4:5', image: img.url, images: JSON.stringify(cat.images.map(i => i.url)), currentIndex: idx, category: cat.name }
                  })}
                >
                  {img.isVideo ? (
                    <VideoThumbnail uri={img.url} style={styles.modernGridImg} />
                  ) : (
                    <Image source={{ uri: img.url }} style={styles.modernGridImg} resizeMode="contain" />
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
        visible={mustSelectState}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
        statusBarTranslucent
      >
        <View style={styles.stateModalOverlay}>
          <View style={styles.stateModalContent}>
            <View style={styles.stateModalIcon}>
              <Ionicons name="location" size={40} color={Colors.primary} />
            </View>
            <Text style={styles.stateModalTitle}>{stateT.title}</Text>
            {stateT.subtitle ? <Text style={styles.stateModalSubtitle}>{stateT.subtitle}</Text> : null}
            <ScrollView style={styles.stateModalList} showsVerticalScrollIndicator={false}>
              {availableStates.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.stateModalItem, selectedStateId === s.id && styles.stateModalItemSelected]}
                  onPress={() => setSelectedStateId(s.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.stateModalItemText, selectedStateId === s.id && styles.stateModalItemTextSelected]}>{s.name}</Text>
                  {selectedStateId === s.id ? <Ionicons name="checkmark-circle" size={24} color={Colors.primary} /> : <View style={styles.stateModalItemCircle} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.stateModalBtn, (selectedStateId == null || stateSaving) && styles.stateModalBtnDisabled]}
              onPress={handleStateProceed}
              disabled={selectedStateId == null || stateSaving}
              activeOpacity={0.8}
            >
              {stateSaving ? (
                <View style={styles.stateModalBtnLoading}>
                  <ActivityIndicator color="#FFF" size="small" />
                  <Text style={[styles.stateModalBtnText, { marginLeft: 8 }]}>Saving...</Text>
                </View>
              ) : (
                <Text style={styles.stateModalBtnText}>{stateT.button}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/profile')} style={styles.profileRow}>
          <View style={styles.avatarPlaceholder}>
            {userInfo?.profilePics?.[0] ? (
              <Image source={{ uri: userInfo.profilePics[0] }} style={{ width: 45, height: 45, borderRadius: 22.5 }} />
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
                fetchPosts(
                  userInfo?.state_id != null ? String(userInfo.state_id) : '',
                  (userInfo?.partyName ?? '').trim()
                )
              }
              style={styles.retryButton}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filteredPosts.length === 0 ? (
          <View style={styles.statusMessage}>
            <Text style={styles.statusText}>{t('no_posts_available')}</Text>
          </View>
        ) : (activeTab === 'graphics' && graphicsData.length === 0) || (activeTab === 'reels' && reelsData.length === 0) ? (
          <View style={styles.statusMessage}>
            <Text style={styles.statusText}>{t('no_active_content')}</Text>
          </View>
        ) : (
          activeCategory ? renderSlidingGrids() : renderHomeRows()
        )}
      </ScrollView>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  stateModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  stateModalContent: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
    padding: 24,
    ...Platform.select({
      web: { boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
      default: { elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16 },
    }),
  },
  stateModalIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  stateModalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.headerColor,
    textAlign: 'center',
    marginBottom: 8,
  },
  stateModalSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  stateModalList: {
    maxHeight: 280,
    marginBottom: 20,
  },
  stateModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: Colors.cardBg,
  },
  stateModalItemSelected: {
    backgroundColor: 'rgba(67, 160, 71, 0.1)',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  stateModalItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  stateModalItemTextSelected: {
    color: Colors.primary,
    fontWeight: '700',
  },
  stateModalItemCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#DDD',
  },
  stateModalBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  stateModalBtnLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateModalBtnDisabled: {
    backgroundColor: Colors.border,
    opacity: 0.7,
  },
  stateModalBtnText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
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
