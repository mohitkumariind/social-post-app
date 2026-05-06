import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { downloadMediaToCache } from '../../lib/mediaCache';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Colors } from '../../constants/Colors';
import { normalizePartyId } from '../../constants/Parties';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { supabase } from '../../lib/supabase';
import { EditProfileScreen } from '../edit-profile';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Dashboard par aane + profile load ke baad, incomplete users ko itni der baad edit-profile modal */
const EDIT_PROFILE_GATE_DELAY_MS = 30_000;

/** Solid skeleton while graphics thumbnails load (no blurhash). */
const IMAGE_SKELETON_BG = '#E8E8E8';

interface Category {
  id: string;
  name: string;
  images: { url: string; shares: string; captions?: string; postId?: string }[];
}

type PostRow = {
  id: string;
  title: string;
  image_url: string;
  category: string;
  event_date?: string;
  // Strict numeric-ID targeting arrays
  state_id?: number[] | number | null;
  loksabha_id?: number[] | number | null;
  assembly_id?: number[] | number | null;
  party_id?: number[] | number | null;
  group_id?: number[] | number | null;
  profile_ids?: string[] | string | null;
  captions?: string | string[];
};

/** `posts.captions` may be TEXT (JSON string) or jsonb array from Supabase. */
function postCaptionsForNavigation(c: string | string[] | null | undefined): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return JSON.stringify(c);
  return '';
}
type EventRow = {
  name: string;
  end: string;
  state_id?: number[] | number | null;
  loksabha_id?: number[] | number | null;
  assembly_id?: number[] | number | null;
  party_id?: number[] | number | null;
  group_id?: number[] | number | null;
  profile_ids?: string[] | string | null;
};

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

function toStrArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
}

function toNumArr(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const n = Number(v);
  return Number.isFinite(n) ? [n] : [];
}

function gfxLogCapped(key: string, payload: unknown, cap = 8) {
  const g: any = globalThis as any;
  const k = `__gfx_${key}`;
  g[k] = typeof g[k] === 'number' ? g[k] : 0;
  if (g[k] >= cap) return;
  try {
    console.log(`[gfx] ${key}`, JSON.stringify(payload));
  } catch {
    console.log(`[gfx] ${key}`, String(payload));
  }
  g[k] += 1;
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
  const { width } = useWindowDimensions();
  const router = useRouter();
  const dashParams = useLocalSearchParams();
  const { userInfo, setUserInfo, profileLoaded, setProfileLoaded, profileRefreshSeq } = useUser();
  const { t, lang } = useLang();
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
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
  const fetchPostsReqIdRef = useRef(0);
  const postsSchemaOkRef = useRef<boolean | null>(null);
  const eventsSchemaOkRef = useRef<boolean | null>(null);
  const profileLoadedRef = useRef<boolean>(false);
  const safeUserInfo = userInfo ?? { name: '', phone: '', state: '', partyName: '' };
  const realtimeChannelRef = useRef<any>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(true);

  // Core rule: never render content until profile is fetched from server.

  // Persistence logs (requested): whenever sync inputs change.
  useEffect(() => {
    console.log('[gfx] Sync Check - ProfileReady:', profileLoaded);
  }, [profileLoaded]);

  useEffect(() => {
    profileLoadedRef.current = !!profileLoaded;
  }, [profileLoaded]);

  // Full worker context (requested)
  useEffect(() => {
    const u: any = userInfoRef.current;
    console.log(
      '[gfx] Full Worker Context:',
      JSON.stringify({
        state_id: u?.state_id ?? null,
        loksabha_id: u?.loksabha_id ?? null,
        assembly_id: u?.assembly_id ?? null,
        party_id: u?.party_id ?? null,
        group_id: u?.group_id ?? null,
        profile_id: u?.profile_id ?? '',
      })
    );
  }, [
    (userInfo as any)?.state_id,
    (userInfo as any)?.loksabha_id,
    (userInfo as any)?.assembly_id,
    (userInfo as any)?.party_id,
    (userInfo as any)?.group_id,
    (userInfo as any)?.profile_id,
  ]);

  // Debug logs for stuck state (requested)
  useEffect(() => {
    const payload = {
      name: (userInfo as any)?.name ?? '',
      state: (userInfo as any)?.state ?? '',
      loading: isProfileLoading,
      profileLoaded,
    };
    // Single-line output for logcat readability
    console.log('[gfx] Current Profile State:', JSON.stringify(payload));
  }, [isProfileLoading, profileLoaded, userInfo?.name, userInfo?.state]);

  const clearDashboardExpandParams = React.useCallback(() => {
    // `setParams` has differed across Expo Router versions / navigators.
    // Guard to prevent a hard crash when returning from PostDetail.
    const r = router as unknown as { setParams?: (p: Record<string, unknown>) => void };
    if (typeof r?.setParams === 'function') {
      r.setParams({ expandCategory: undefined, expandTab: undefined });
    }
  }, [router]);

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

  /** Fetch authenticated user profile from profiles table. */
  const fetchUserProfile = React.useCallback(async () => {
    try {
      await supabase.auth.refreshSession();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id ?? null;
      if (!userId) throw new Error('Auth session missing');

      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'id, state, state_id, loksabha_id, assembly_id, party_id, group_id, language, party, name, phone, avatar_url, designation1, designation2, designation3, designation4, whatsapp, facebook, instagram, twitter'
        )
        .eq('id', userId)
        .single();

      if (profile) {
        const langRaw = String((profile as { language?: string }).language ?? '').trim();
        const rawParty = String(profile.party ?? '').trim();
        const party = normalizePartyId(rawParty) || rawParty;
        const stateIdFromDb =
          typeof (profile as any).state_id === 'number'
            ? (profile as any).state_id
            : (profile as any).state_id != null
              ? Number((profile as any).state_id)
              : null;
        const partyIdFromDb =
          typeof (profile as any).party_id === 'number'
            ? (profile as any).party_id
            : (profile as any).party_id != null
              ? Number((profile as any).party_id)
              : null;
        const lokIdFromDb =
          typeof (profile as any).loksabha_id === 'number'
            ? (profile as any).loksabha_id
            : (profile as any).loksabha_id != null
              ? Number((profile as any).loksabha_id)
              : null;
        const asmIdFromDb =
          typeof (profile as any).assembly_id === 'number'
            ? (profile as any).assembly_id
            : (profile as any).assembly_id != null
              ? Number((profile as any).assembly_id)
              : null;
        const groupIdFromDb =
          typeof (profile as any).group_id === 'number'
            ? (profile as any).group_id
            : (profile as any).group_id != null
              ? Number((profile as any).group_id)
              : null;
        const nameFromDb = String(profile.name ?? '').trim();
        const phoneFromDb = String(profile.phone ?? '').trim();
        const stateFromDb = String((profile as any).state ?? '').trim();
        const avatarUrl = String((profile as { avatar_url?: string }).avatar_url ?? '').trim();
        setUserInfo((prev) => ({
          ...prev,
          profile_id: String((profile as any).id ?? userId),
          language: langRaw || prev.language,
          name: nameFromDb,
          phone: phoneFromDb,
          state: stateFromDb || prev.state,
          state_id: Number.isNaN(stateIdFromDb as number) ? prev.state_id : stateIdFromDb,
          party_id: Number.isNaN(partyIdFromDb as number) ? prev.party_id : partyIdFromDb,
          loksabha_id: Number.isNaN(lokIdFromDb as number) ? prev.loksabha_id : lokIdFromDb,
          assembly_id: Number.isNaN(asmIdFromDb as number) ? prev.assembly_id : asmIdFromDb,
          group_id: Number.isNaN(groupIdFromDb as number) ? (prev as any).group_id : groupIdFromDb,
          partyName: party || prev.partyName,
          avatar_url: avatarUrl,
          designation1: String((profile as { designation1?: string }).designation1 ?? prev.designation1 ?? ''),
          designation2: String((profile as { designation2?: string }).designation2 ?? prev.designation2 ?? ''),
          designation3: String((profile as { designation3?: string }).designation3 ?? prev.designation3 ?? ''),
          designation4: String((profile as { designation4?: string }).designation4 ?? prev.designation4 ?? ''),
          whatsapp: String((profile as { whatsapp?: string }).whatsapp ?? prev.whatsapp ?? ''),
          facebook: String((profile as { facebook?: string }).facebook ?? prev.facebook ?? ''),
          instagram: String((profile as { instagram?: string }).instagram ?? prev.instagram ?? ''),
          twitter: String((profile as { twitter?: string }).twitter ?? prev.twitter ?? ''),
        }));
        setIsProfileLoading(false);
        profileLoadedRef.current = true;
        setProfileLoaded(true);
        return { state: '', party };
      }
    } catch (e) {
      console.error('[gfx] Profile Fetch Error: ', e);
      setProfileLoaded(false);
      profileLoadedRef.current = false;
      setIsProfileLoading(false);
    }
    return { state: '', party: '' };
  }, [setUserInfo, setProfileLoaded]);

  function normalizeStrictId(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function explainVisibility(user: any, content: any) {
    const result: any = {
      ok: false,
      reason: 'unknown',
    };
    if (!profileLoadedRef.current) {
      result.reason = 'profile_not_loaded';
      return result;
    }

    const uParty = normalizeStrictId(Number(user?.party_id));
    const uState = normalizeStrictId(Number(user?.state_id));
    const uLok = normalizeStrictId(Number(user?.loksabha_id));
    const uAsm = normalizeStrictId(Number(user?.assembly_id));
    const uGroup = normalizeStrictId(user?.group_id);
    const uProfileId = String(user?.profile_id ?? '').trim();

    const partyIds = toNumArr(content?.party_id);
    const stateIds = toNumArr(content?.state_id);
    const lokIds = toNumArr(content?.loksabha_id);
    const asmIds = toNumArr(content?.assembly_id);
    const groupIds = toNumArr(content?.group_id);
    const profileIds = toStrArr(content?.profile_ids).map((x) => String(x).trim()).filter(Boolean);

    Object.assign(result, {
      u: { uParty, uState, uLok, uAsm, uGroup, uProfileId },
      c: { partyIds, stateIds, lokIds, asmIds, groupIds, profileIds },
    });

    if (!uProfileId) {
      result.reason = 'missing_user_profile_id';
      return result;
    }
    if (uParty == null || uState == null) {
      result.reason = 'missing_user_party_or_state';
      return result;
    }

    // Empty arrays mean "no restriction" and are valid.
    // Only treat as invalid when the raw array is non-empty but parsing yields empty.
    if (Array.isArray(content?.party_id) && content.party_id.length > 0 && partyIds.length === 0) {
      result.reason = 'invalid_party_id_array';
      return result;
    }
    if (Array.isArray(content?.state_id) && content.state_id.length > 0 && stateIds.length === 0) {
      result.reason = 'invalid_state_id_array';
      return result;
    }
    if (Array.isArray(content?.loksabha_id) && content.loksabha_id.length > 0 && lokIds.length === 0) {
      result.reason = 'invalid_loksabha_id_array';
      return result;
    }
    if (Array.isArray(content?.assembly_id) && content.assembly_id.length > 0 && asmIds.length === 0) {
      result.reason = 'invalid_assembly_id_array';
      return result;
    }
    if (Array.isArray(content?.group_id) && content.group_id.length > 0 && groupIds.length === 0) {
      result.reason = 'invalid_group_id_array';
      return result;
    }
    if (Array.isArray(content?.profile_ids) && content.profile_ids.length > 0 && profileIds.length === 0) {
      result.reason = 'invalid_profile_ids_array';
      return result;
    }

    const isGlobal =
      partyIds.length === 0 &&
      stateIds.length === 0 &&
      lokIds.length === 0 &&
      asmIds.length === 0 &&
      groupIds.length === 0 &&
      profileIds.length === 0;
    if (isGlobal) {
      result.ok = true;
      result.reason = 'global';
      return result;
    }

    const stateMatch = stateIds.length === 0 ? true : stateIds.includes(0) || stateIds.includes(uState);
    if (!stateMatch) {
      result.reason = 'state_mismatch';
      return result;
    }
    const partyMatch = partyIds.length === 0 ? true : partyIds.includes(0) || partyIds.includes(uParty);
    if (!partyMatch) {
      result.reason = 'party_mismatch';
      return result;
    }

    if (lokIds.length > 0 && !lokIds.includes(0)) {
      if (uLok == null) {
        result.reason = 'missing_user_loksabha_id';
        return result;
      }
      if (!lokIds.includes(uLok)) {
        result.reason = 'loksabha_mismatch';
        return result;
      }
    }
    if (asmIds.length > 0 && !asmIds.includes(0)) {
      if (uAsm == null) {
        result.reason = 'missing_user_assembly_id';
        return result;
      }
      if (!asmIds.includes(uAsm)) {
        result.reason = 'assembly_mismatch';
        return result;
      }
    }
    if (groupIds.length > 0) {
      if (uGroup == null) {
        result.reason = 'missing_user_group_id';
        return result;
      }
      if (!groupIds.includes(0) && !groupIds.includes(uGroup)) {
        result.reason = 'group_mismatch';
        return result;
      }
    }
    if (profileIds.length > 0 && !profileIds.includes(uProfileId)) {
      result.reason = 'profile_id_mismatch';
      return result;
    }

    result.ok = true;
    result.reason = 'ok';
    return result;
  }

  function canUserSeeContent(user: any, content: any): boolean {
    return explainVisibility(user, content).ok;
  }

  const fetchPosts = React.useCallback(async (_userState: string, _userParty: string, silent = false) => {
    const reqId = ++fetchPostsReqIdRef.current;
    try {
      if (!silent) {
        setFetchError(null);
        setLoading(true);
      }
      gfxLogCapped(
        'updates',
        {
          runtimeVersion: (Updates as any).runtimeVersion ?? null,
          channel: (Updates as any).channel ?? 'unknown',
          updateId: Updates.updateId ?? null,
          isEmbeddedLaunch: Updates.isEmbeddedLaunch,
          isEmergencyLaunch: Updates.isEmergencyLaunch,
        },
        3
      );
      const userProfile = userInfoRef.current as any;
      const workerStateId = userProfile?.state_id ?? null;
      const workerLoksabhaId = userProfile?.loksabha_id ?? null;
      const workerAssemblyId = userProfile?.assembly_id ?? null;
      const workerPartyId = userProfile?.party_id ?? null;
      const workerGroupId = userProfile?.group_id ?? null;
      const workerProfileId = String(userProfile?.profile_id ?? '').trim();

      // Graphics only: not a reel (`is_video` true). Uses false OR NULL so legacy image rows (unset flag) still show.
      // NOTE: We intentionally avoid DB-side `contains(state/party, ...)` here because NULL/empty targeting
      // should be treated as "global" on the client. DB-side filters can accidentally exclude global rows.
      // Strict numeric-ID mode: no legacy fallback (default deny if schema isn't migrated).
      const runNumeric = async () =>
        await supabase
          .from('posts')
          .select(
            'id,title,image_url,category,event_date,created_at,captions,state_id,loksabha_id,assembly_id,party_id,group_id,profile_ids'
          )
          .or('is_video.eq.false,is_video.is.null')
          .order('created_at', { ascending: false })
          .limit(300);

      // If we already detected missing columns, skip querying to avoid repeated errors.
      if (postsSchemaOkRef.current === false) {
        setPosts([]);
        setLoading(false);
        return;
      }

      let data: any[] | null = null;
      let error: any = null;
      {
        const r = await runNumeric();
        data = (r as any)?.data ?? null;
        error = (r as any)?.error ?? null;
      }

      gfxLogCapped('userGeo', {
        state_id: workerStateId,
        loksabha_id: workerLoksabhaId,
        assembly_id: workerAssemblyId,
        party_id: workerPartyId,
        group_id: workerGroupId,
        profile_id: workerProfileId,
      });

      if (reqId !== fetchPostsReqIdRef.current) return;
      if (error) {
        const msg = String(error.message ?? 'Failed to load posts');
        if (msg.includes('does not exist')) {
          postsSchemaOkRef.current = false;
          setFetchError('DB schema missing required numeric columns for posts. Please add posts.state_id/loksabha_id/assembly_id/party_id.');
        } else {
          setFetchError(msg);
        }
        if (__DEV__) {
          console.warn('[Dashboard fetchPosts] Supabase error:', {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          });
        }
        if (__DEV__) console.warn('[Dashboard fetchPosts] raw error object:', error);
        setPosts([]);
        return;
      }
      const raw = (data || []) as PostRow[];
      let rejectedLogged = false;
      const filtered = raw.filter((p) => {
        const ex = explainVisibility(userInfoRef.current, p);
        const ok = ex.ok;
        if (!ok && !rejectedLogged) {
          rejectedLogged = true;
          gfxLogCapped('rejectSample', {
            postId: (p as any)?.id ?? null,
            party_id: (p as any)?.party_id ?? null,
            state_id: (p as any)?.state_id ?? null,
            loksabha_id: (p as any)?.loksabha_id ?? null,
            assembly_id: (p as any)?.assembly_id ?? null,
            user: {
              state_id: (userInfoRef.current as any)?.state_id ?? null,
              party_id: (userInfoRef.current as any)?.party_id ?? null,
              loksabha_id: (userInfoRef.current as any)?.loksabha_id ?? null,
              assembly_id: (userInfoRef.current as any)?.assembly_id ?? null,
              profile_id: (userInfoRef.current as any)?.profile_id ?? '',
            },
          });
          gfxLogCapped('rejectReason', ex, 5);
        }
        return ok;
      });
      gfxLogCapped('filterCounts', { raw: raw.length, kept: filtered.length });
      setPosts(filtered);
    } catch (err) {
      if (reqId !== fetchPostsReqIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(msg);
      if (__DEV__) console.warn('[Dashboard fetchPosts] exception:', err);
      setPosts([]);
    } finally {
      if (reqId === fetchPostsReqIdRef.current && !silent) setLoading(false);
    }
  }, []);

  const fetchEvents = async () => {
    try {
      const userProfile = userInfoRef.current as any;
      const workerStateId = userProfile?.state_id ?? null;
      const workerLoksabhaId = userProfile?.loksabha_id ?? null;
      const workerAssemblyId = userProfile?.assembly_id ?? null;
      const workerPartyId = userProfile?.party_id ?? null;
      const workerGroupId = userProfile?.group_id ?? null;
      const workerProfileId = String(userProfile?.profile_id ?? '').trim();

      const runNumeric = async () =>
        await supabase
          .from('events')
          .select('name,end,state_id,loksabha_id,assembly_id,party_id,group_id,profile_ids')
          .order('end', { ascending: true })
          .limit(500);

      // If we already detected missing columns, skip querying to avoid repeated errors.
      if (eventsSchemaOkRef.current === false) {
        setEvents([]);
        return;
      }

      let data: any[] | null = null;
      let error: any = null;
      {
        const r = await runNumeric();
        data = (r as any)?.data ?? null;
        error = (r as any)?.error ?? null;
      }
      if (error) {
        const msg = String(error.message ?? 'Failed to load events');
        if (msg.includes('does not exist')) {
          eventsSchemaOkRef.current = false;
          setFetchError((prev) => prev ?? 'DB schema missing required numeric columns for events. Please add events.state_id/loksabha_id/assembly_id/party_id.');
        } else {
          setFetchError((prev) => prev ?? msg);
        }
        setEvents([]);
        return;
      }
      const raw = ((data ?? []) as any[]).filter(Boolean);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const filteredEvents = raw
        .filter((ev) => {
          return canUserSeeContent(userInfoRef.current, ev);
        })
        .filter((ev) => {
        const evEndDate = new Date(ev.end);
        evEndDate.setUTCHours(0, 0, 0, 0);
        return evEndDate.getTime() >= today.getTime();
      });
      setEvents(filteredEvents);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? 'Failed to load events');
      setFetchError((prev) => prev ?? msg);
      setEvents([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await supabase.auth.getSession();
      if (cancelled) return;
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      if (refreshKey === 0 && !hasFetchedProfileRef.current) {
        hasFetchedProfileRef.current = true;
        setProfileLoaded(false);
        setIsProfileLoading(true);
        await fetchUserProfile();
        if (cancelled) return;
      } else {
        // keep latest profile in sync (best-effort) but don't block UI
        void fetchUserProfile();
      }

      // Hard gate: do not fetch feed until profile is loaded from server.
      if (!profileLoaded) return;

      // Profile is loaded; fetch posts now.
      await fetchPosts('', '');
      if (!cancelled) setDashboardProfileLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    refreshKey,
    profileLoaded,
    fetchUserProfile,
    fetchPosts,
  ]);

  // After a successful profile refresh (e.g., after saving Edit Profile), refetch feed using fresh IDs.
  useEffect(() => {
    if (!authReady) return;
    if (!profileLoaded) return;
    void (async () => {
      await fetchPosts('', '', true);
      await fetchEvents();
    })();
  }, [authReady, profileLoaded, profileRefreshSeq, fetchPosts]);

  useEffect(() => {
    if (!authReady || !profileLoaded || !dashboardProfileLoaded) {
      setEditProfileDelayedVisible(false);
      return;
    }
    if (!isProfileIncomplete(safeUserInfo)) {
      setEditProfileDelayedVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      if (isProfileIncomplete(userInfoRef.current)) {
        setEditProfileDelayedVisible(true);
      }
    }, EDIT_PROFILE_GATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    authReady,
    dashboardProfileLoaded,
    safeUserInfo?.name,
    safeUserInfo?.phone,
    safeUserInfo?.state,
    safeUserInfo?.partyName,
  ]);

  const showEditProfileModal =
    editProfileDelayedVisible && authReady && dashboardProfileLoaded && isProfileIncomplete(safeUserInfo);

  const handleProfileSaved = React.useCallback(() => {
    // EditProfileScreen now runs: upsert → refetch profile → hydrate context → bump profileRefreshSeq.
    // Here we only ensure our local "first-run" bootstrap refetches from server as well.
    void fetchUserProfile();
  }, [fetchUserProfile]);

  useEffect(() => {
    if (!authReady) return;
    if (!profileLoaded) return;
    fetchEvents();
    try {
      // IMPORTANT: Do not reuse a fixed channel name here.
      // Dashboard can mount more than once (router.replace/back, tab stack behavior),
      // and Supabase will return the existing subscribed channel for the same name.
      // Adding callbacks after subscribe throws and can blank-screen the app.
      if (realtimeChannelRef.current) {
        try {
          supabase.removeChannel(realtimeChannelRef.current);
        } catch {
          // ignore
        }
        realtimeChannelRef.current = null;
      }

      const channelName = `realtime-any-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const channel = supabase
        .channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => setRefreshKey((p) => p + 1))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => setRefreshKey((p) => p + 1))
        .subscribe();
      realtimeChannelRef.current = channel;
    } catch (e) {
      if (__DEV__) console.warn('[Dashboard] realtime subscribe failed:', e);
    }
    return () => {
      const ch = realtimeChannelRef.current;
      realtimeChannelRef.current = null;
      if (ch) {
        try {
          supabase.removeChannel(ch);
        } catch {
          // ignore
        }
      }
    };
  }, [authReady, profileLoaded, fetchEvents]);

  const safePosts = Array.isArray(posts) ? posts : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const filteredPosts = safePosts;

  const postsByCategory = React.useMemo(() => {
    const map = new Map<string, Category>();
    for (const p of filteredPosts) {
      if (!p.image_url) continue;
      const catName = p.category || 'Latest';
      const catId = catName.toLowerCase().replace(/\s+/g, '-');
      if (!map.has(catId)) {
        map.set(catId, { id: catId, name: catName, images: [] });
      }
      map.get(catId)!.images.push({
        url: p.image_url,
        shares: '0',
        captions: postCaptionsForNavigation(p.captions),
        postId: p.id,
      });
    }
    return Array.from(map.values());
  }, [filteredPosts, refreshKey]);

  const graphicsData = React.useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (safeEvents.length === 0) return postsByCategory;
    // Event name matching must be case-insensitive (category ↔ event.name).
    const activeEventNamesLower = new Set(safeEvents.map((e) => String(e.name ?? '').trim().toLowerCase()).filter(Boolean));
    const eventEndByNameLower = new Map(safeEvents.map((e) => [String(e.name ?? '').trim().toLowerCase(), e.end] as const));
    const filtered = postsByCategory.filter((cat) => {
      const catNameLower = String(cat.name ?? '').trim().toLowerCase();
      if (!catNameLower) return false;
      if (!activeEventNamesLower.has(catNameLower)) return false;
      const evEnd = eventEndByNameLower.get(catNameLower);
      if (!evEnd) return false;
      const evEndDate = new Date(evEnd);
      evEndDate.setUTCHours(0, 0, 0, 0);
      return evEndDate.getTime() >= today.getTime();
    });
    // Debug logs (requested): event name + category match (capped)
    if (__DEV__) {
      const globalAny = globalThis as any;
      globalAny.__dbgEventMatchLogs = typeof globalAny.__dbgEventMatchLogs === 'number' ? globalAny.__dbgEventMatchLogs : 0;
      if (globalAny.__dbgEventMatchLogs < 10) {
        console.log('Event Name:', safeEvents?.[0]?.name);
        console.log('Graphic Category:', postsByCategory?.[0]?.name);
        globalAny.__dbgEventMatchLogs += 1;
      }
    }
    const result =
      filtered.length === 0
        ? []
        : filtered.sort((a, b) => {
            const endA = eventEndByNameLower.get(String(a.name ?? '').trim().toLowerCase());
            const endB = eventEndByNameLower.get(String(b.name ?? '').trim().toLowerCase());
            if (!endA || !endB) return 0;
            return new Date(endA).getTime() - new Date(endB).getTime();
          });
    return result.length > 0 ? result : postsByCategory;
  }, [postsByCategory, safeEvents, refreshKey]);

  const CURRENT_DATA = graphicsData;

  useEffect(() => {
    const itemWidth = 140 + 15;
    const initialOffset = itemWidth * CURRENT_DATA.length;
    trendingRef.current?.scrollTo({ x: initialOffset, animated: false });
  }, [CURRENT_DATA.length, lang]);

  const allTrending = useMemo(() => {
    return CURRENT_DATA.filter((cat) => cat.images.length > 0).map((cat) => ({ ...cat.images[0], catSource: cat }));
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
    const catParamRaw = dashParams?.expandCategory;
    const expandCategory =
      typeof catParamRaw === 'string' ? catParamRaw : Array.isArray(catParamRaw) ? catParamRaw[0] : undefined;
    if (!expandCategory || CURRENT_DATA.length === 0) return;
    const expandKey = expandCategory;
    if (consumedExpandKeyRef.current === expandKey) return;
    const idx = CURRENT_DATA.findIndex((c) => c.name === expandCategory);
    if (idx === -1) return;
    const target = CURRENT_DATA[idx];
    if (activeCategory?.id === target.id) return;
    consumedExpandKeyRef.current = expandKey;
    switchCategory(target, idx);
    clearDashboardExpandParams();
  }, [dashParams?.expandCategory, CURRENT_DATA, activeCategory, clearDashboardExpandParams]);

  useEffect(() => {
    const onBackPress = () => {
      if (activeCategory) {
        setActiveCategory(null);
        clearDashboardExpandParams();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [activeCategory, clearDashboardExpandParams]);

  const renderTrendingSection = () => (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {t('trending')} {t('graphics')}
        </Text>
        {activeCategory && (
          <TouchableOpacity onPress={() => setActiveCategory(null)} style={styles.backLink}>
            <Text style={styles.backLinkText}>{t('explore_all')} 🚀</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        ref={trendingRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={handleTrendingScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingLeft: 20 }}
      >
        {infiniteTrendingData.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.trendingItem, { height: Math.round(140 * 5 / 4) }]}
            onPress={() => switchCategory(item.catSource, index % allTrending.length)}
          >
            <ExpoImage
              source={{ uri: dailyLocalByUrl[item.url] || item.url }}
              style={styles.postImage}
              contentFit="contain"
              cachePolicy="disk"
              onLoadStart={() => void ensureDailyCached(item.url)}
            />
            <View style={styles.catLabelBadge}>
              <Text style={styles.catLabelText}>{item.catSource.name}</Text>
            </View>
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
                key={index}
                style={[styles.postItem, { width: (width - 55) / 2, height: Math.round(((width - 55) / 2) * 5 / 4) }]}
                onPress={() => switchCategory(cat, idx)}
              >
                <ExpoImage
                  source={{ uri: dailyLocalByUrl[img.url] || img.url }}
                  style={styles.postImage}
                  contentFit="contain"
                  cachePolicy="disk"
                  onLoadStart={() => void ensureDailyCached(img.url)}
                />
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
        ref={categoryCarouselRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleGridScroll}
        scrollEventThrottle={16}
      >
        <View style={{ width: width, justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity style={[styles.allTrendingBackCard, { width: width - 80 }]} onPress={() => setActiveCategory(null)}>
            <LinearGradient colors={[Colors.primary, Colors.accent]} style={styles.allTrendingGradient}>
              <Ionicons name="apps" size={50} color="#FFF" />
              <Text style={styles.allTrendingTitle}>{t('graphics')}</Text>
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
                  key={idx}
                  style={[
                    styles.modernGridItem,
                    {
                      width: (width - 50) / 2,
                      height: Math.round(((width - 50) / 2) * 5 / 4),
                      marginTop: idx % 2 === 0 ? 0 : 25,
                    },
                  ]}
                  onPress={() =>
                    router.push({
                      pathname: '/(auth)/post-detail',
                      params: {
                        image: img.url,
                        images: JSON.stringify(cat.images.map((i) => i.url)),
                        currentIndex: idx,
                        category: cat.name,
                        captions: img.captions || '',
                        postId: img.postId ?? '',
                      },
                    })
                  }
                >
                  <ExpoImage
                    source={{ uri: dailyLocalByUrl[img.url] || img.url }}
                    style={styles.modernGridImg}
                    contentFit="contain"
                    cachePolicy="disk"
                    onLoadStart={() => void ensureDailyCached(img.url)}
                  />
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
        {!Array.isArray(posts) || !Array.isArray(events) ? (
          <View style={styles.statusMessage}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={[styles.statusText, { marginTop: 12 }]}>Loading...</Text>
          </View>
        ) : (
          <>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.push('/profile')} style={styles.profileRow}>
            <View style={styles.avatarPlaceholder}>
              {userInfo?.avatar_url ? (
                <ExpoImage
                  source={{ uri: userInfo.avatar_url }}
                  style={{ width: 45, height: 45, borderRadius: 22.5, backgroundColor: IMAGE_SKELETON_BG }}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              ) : (
                <Ionicons name="person" size={24} color={Colors.accent} />
              )}
            </View>
            <View style={styles.welcomeTextGroup}>
              <Text style={styles.welcomeText}>{t('welcome')}!</Text>
              <Text style={styles.userName}>
                {t('hi_user')}, {String(userInfo?.name ?? '').trim().split(' ')[0] || t('user')}
              </Text>
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
          <View style={styles.gradientHeaderWrapper}>
            <LinearGradient colors={[Colors.primary, Colors.accent]} style={styles.eclipseGradient}>
              <Text style={styles.modernCenterTitle}>
                {activeCategory ? activeCategory.name : 'Daily Trending Graphics'}
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
                onPress={async () => {
                  if (retrying) return;
                  setRetrying(true);
                  try {
                    await fetchPosts('', '');
                  } finally {
                    setRetrying(false);
                  }
                }}
                style={[styles.retryButton, retrying && { opacity: 0.7 }]}
                disabled={retrying}
              >
                <Text style={styles.retryButtonText}>{retrying ? 'Retrying...' : 'Retry'}</Text>
              </TouchableOpacity>
            </View>
          ) : filteredPosts.length === 0 || graphicsData.length === 0 ? (
            <View style={styles.statusMessage}>
              <Text style={styles.statusText}>No graphics available right now.</Text>
            </View>
          ) : activeCategory ? (
            renderSlidingGrids()
          ) : (
            renderHomeRows()
          )}
        </ScrollView>
          </>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingHorizontal: 25,
    paddingBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
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
  avatarPlaceholder: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: '#E8EAF6',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  welcomeTextGroup: { marginLeft: 12 },
  welcomeText: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' },
  userName: { fontSize: 18, fontWeight: '800', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  gradientHeaderWrapper: { height: 60, marginVertical: 10, paddingHorizontal: 20 },
  eclipseGradient: { height: 50, width: '100%', borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  modernCenterTitle: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  sectionContainer: { marginTop: 25 },
  sectionHeader: {
    paddingHorizontal: 25,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  viewAllText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  backLink: { backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  backLinkText: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
  trendingItem: {
    width: 140,
    borderRadius: Colors.borderRadius,
    overflow: 'hidden',
    marginRight: 15,
    backgroundColor: Colors.cardBg,
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
  },
  postGridRow: { flexDirection: 'row', paddingHorizontal: 20, justifyContent: 'space-between' },
  postItem: {
    borderRadius: Colors.borderRadius,
    overflow: 'hidden',
    backgroundColor: Colors.cardBg,
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
  },
  postImage: { width: '100%', height: '100%', backgroundColor: IMAGE_SKELETON_BG },
  catLabelBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(142, 36, 170, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    elevation: 3,
  },
  catLabelText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  gridSectionHeader: { paddingHorizontal: 25, marginBottom: 15, marginTop: 10 },
  gridSectionTitle: { fontSize: 22, fontWeight: '900', color: Colors.headerColor, fontFamily: Colors.fontFamilyBold },
  gridSectionSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  allTrendingBackCard: {
    height: 350,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  allTrendingGradient: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 15 },
  allTrendingTitle: { color: '#FFF', fontSize: 28, fontWeight: '900' },
  allTrendingSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
  staggeredContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingBottom: 50,
  },
  modernGridItem: {
    borderRadius: Colors.borderRadius,
    overflow: 'hidden',
    backgroundColor: Colors.cardBg,
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
  },
  modernGridImg: { width: '100%', height: '100%', backgroundColor: IMAGE_SKELETON_BG },
  modernShareLabel: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  modernShareText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  statusMessage: { paddingVertical: 40, paddingHorizontal: 25, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontSize: 16, fontWeight: '700', color: Colors.textMuted },
  statusError: { fontSize: 14, fontWeight: '600', color: Colors.error, textAlign: 'center' },
  retryButton: { marginTop: 20, paddingVertical: 14, paddingHorizontal: 28, backgroundColor: Colors.primary, borderRadius: 12 },
  retryButtonText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});
