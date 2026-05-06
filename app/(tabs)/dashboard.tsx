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
  party?: string[] | string;
  state?: string[] | string;
  loksabha?: string[] | string;
  assembly?: string[] | string;
  target_groups?: string[] | string;
  captions?: string | string[];
};

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

function toStrArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
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
  const { userInfo, setUserInfo } = useUser();
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
  const safeUserInfo = userInfo ?? { name: '', phone: '', state: '', partyName: '' };
  const realtimeChannelRef = useRef<any>(null);
  const stateNameToIdRef = useRef<Map<string, string>>(new Map());
  const [normalizedUserStateId, setNormalizedUserStateId] = useState<string>('');
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [profileFetchTimedOut, setProfileFetchTimedOut] = useState(false);

  const getUserStateId = React.useCallback(async (normalizedStateName: string): Promise<string> => {
    const key = String(normalizedStateName ?? '').trim().toLowerCase();
    if (!key) return '';
    const cached = stateNameToIdRef.current.get(key);
    if (cached) return cached;
    try {
      // Best-effort lookup: profiles.state is state name, posts.state is state_id (string) in many rows.
      const escaped = key.replace(/[%_]/g, (m) => `\\${m}`);
      const { data, error } = await supabase
        .from('states')
        .select('id,name')
        .ilike('name', `%${escaped}%`)
        .order('name', { ascending: true })
        .limit(1);
      if (error) return '';
      const first = Array.isArray(data) ? data[0] : null;
      const id = first?.id != null ? String(first.id) : '';
      if (id) stateNameToIdRef.current.set(key, id);
      return id;
    } catch {
      return '';
    }
  }, []);

  // Recompute state-name -> state_id mapping whenever profile state changes.
  useEffect(() => {
    let cancelled = false;
    const userProfile = userInfoRef.current;
    const stateName = normalizeForCompare(String(userProfile?.state ?? ''));
    (async () => {
      const id = stateName ? await getUserStateId(stateName) : '';
      if (cancelled) return;
      setNormalizedUserStateId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [userInfo?.state, getUserStateId]);

  // Profile loading guard: block fetch until name + state exist.
  useEffect(() => {
    const nameOk = String(userInfo?.name ?? '').trim().length > 0;
    const stateOk = String(userInfo?.state ?? '').trim().length > 0;
    const loadingNow = !(nameOk && stateOk);
    setIsProfileLoading(loadingNow);
    if (!loadingNow) setProfileFetchTimedOut(false);
  }, [userInfo?.name, userInfo?.state]);

  // Profile fetch timeout (10s): unblock so global graphics can still show.
  useEffect(() => {
    if (!authReady) return;
    if (!isProfileLoading) return;
    if (profileFetchTimedOut) return;
    const t = setTimeout(() => {
      console.error('[gfx] Profile Fetch Timeout: profile not ready after 10s');
      setProfileFetchTimedOut(true);
      setIsProfileLoading(false);
    }, 10_000);
    return () => clearTimeout(t);
  }, [authReady, isProfileLoading, profileFetchTimedOut]);

  // Persistence logs (requested): whenever sync inputs change.
  useEffect(() => {
    console.log(
      '[gfx] Sync Check - ProfileReady:',
      !isProfileLoading,
      'StateID:',
      normalizedUserStateId,
      'GroupTags:',
      (userInfo as any)?.group_tags
    );
  }, [isProfileLoading, normalizedUserStateId, (userInfo as any)?.group_tags]);

  // Debug logs for stuck state (requested)
  useEffect(() => {
    const payload = {
      name: (userInfo as any)?.name ?? '',
      state: (userInfo as any)?.state ?? '',
      loading: isProfileLoading,
      timedOut: profileFetchTimedOut,
    };
    // Single-line output for logcat readability
    console.log('[gfx] Current Profile State:', JSON.stringify(payload));
  }, [isProfileLoading, profileFetchTimedOut, userInfo?.name, userInfo?.state]);

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
          'state, state_id, language, group_tags, loksabha_id, loksabha, assembly_id, assembly, party, name, phone, avatar_url, designation1, designation2, designation3, designation4, whatsapp, facebook, instagram, twitter'
        )
        .eq('id', userId)
        .single();

      if (profile) {
        const langRaw = String((profile as { language?: string }).language ?? '').trim();
        const groupTags = Array.isArray((profile as any).group_tags)
          ? ((profile as any).group_tags as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
          : [];
        const rawParty = String(profile.party ?? '').trim();
        const party = normalizePartyId(rawParty) || rawParty;
        const stateStr = String(profile.state ?? '').trim();
        const stateIdFromDb =
          typeof (profile as any).state_id === 'number'
            ? (profile as any).state_id
            : (profile as any).state_id != null
              ? Number((profile as any).state_id)
              : null;
        const nameFromDb = String(profile.name ?? '').trim();
        const phoneFromDb = String(profile.phone ?? '').trim();
        const avatarUrl = String((profile as { avatar_url?: string }).avatar_url ?? '').trim();
        setUserInfo((prev) => ({
          ...prev,
          language: langRaw || prev.language,
          group_tags: groupTags,
          name: nameFromDb,
          phone: phoneFromDb,
          state: stateStr || prev.state,
          state_id: Number.isNaN(stateIdFromDb as number) ? prev.state_id : stateIdFromDb,
          loksabha_id: profile.loksabha_id ?? prev.loksabha_id,
          loksabha: String((profile as { loksabha?: string }).loksabha ?? prev.loksabha ?? ''),
          assembly_id: profile.assembly_id ?? prev.assembly_id,
          assembly: String((profile as { assembly?: string }).assembly ?? prev.assembly ?? ''),
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

        // Initial sync (requested): if state name exists but state_id is null, resolve it and update local userInfo.
        if (stateStr && (stateIdFromDb == null || Number.isNaN(stateIdFromDb as number))) {
          const resolved = await getUserStateId(normalizeForCompare(stateStr));
          const resolvedNum = resolved ? Number(resolved) : NaN;
          if (!Number.isNaN(resolvedNum)) {
            setUserInfo((prev) => ({ ...prev, state_id: resolvedNum }));
            setNormalizedUserStateId(String(resolvedNum));
          }
        }
        return { state: stateStr, party };
      }
    } catch (e) {
      console.error('[gfx] Profile Fetch Error: ', e);
    }
    return { state: '', party: '' };
  }, [setUserInfo]);

  const fetchPosts = React.useCallback(async (userState: string, userParty: string, silent = false) => {
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
      const normalizedUserState = normalizeForCompare(userState || '');
      const normalizedUserParty = normalizeForCompare(normalizePartyId(userParty || '') || userParty || '');
      // Use mapped state_id computed from `userProfile.state`.
      const resolvedUserStateId = normalizedUserStateId;
      const userLoksabhaId = userInfoRef.current?.loksabha_id;
      const userAssemblyId = userInfoRef.current?.assembly_id;
      const userGroupTags = Array.isArray(userInfoRef.current?.group_tags)
        ? userInfoRef.current.group_tags.map((x) => String(x).trim()).filter(Boolean)
        : [];

      // Graphics only: not a reel (`is_video` true). Uses false OR NULL so legacy image rows (unset flag) still show.
      // NOTE: We intentionally avoid DB-side `contains(state/party, ...)` here because NULL/empty targeting
      // should be treated as "global" on the client. DB-side filters can accidentally exclude global rows.
      const runGeoQuery = async () => {
        let q = supabase
          .from('posts')
          .select('id,title,image_url,category,event_date,party,state,loksabha,assembly,target_groups,created_at,captions')
          .or('is_video.eq.false,is_video.is.null')
          .order('created_at', { ascending: false });

        // Only non-tag-targeted content in geo query (direct mapping handled separately).
        q = q.or('target_groups.is.null,target_groups.eq.{}');
        return await q;
      };

      const runTargetedQuery = async () => {
        if (userGroupTags.length === 0) return { data: [], error: null } as any;
        const q = supabase
          .from('posts')
          .select('id,title,image_url,category,event_date,party,state,loksabha,assembly,target_groups,created_at,captions')
          .or('is_video.eq.false,is_video.is.null')
          .overlaps('target_groups', userGroupTags)
          .order('created_at', { ascending: false });
        return await q;
      };

      const runGlobalQuery = async () => {
        // "Global" means all targeting arrays are empty (show to all).
        const q = supabase
          .from('posts')
          .select('id,title,image_url,category,event_date,party,state,loksabha,assembly,target_groups,created_at,captions')
          .or('is_video.eq.false,is_video.is.null')
          .eq('state', '{}')
          .eq('party', '{}')
          .eq('loksabha', '{}')
          .eq('assembly', '{}')
          .eq('target_groups', '{}')
          .order('created_at', { ascending: false });
        return await q;
      };

      // Multi-query strategy:
      // - Direct mapping content (target_groups overlap) should be visible regardless of geo/party.
      // - Geo content is fetched via contains(state/party) and requires target_groups empty.
      // - Global content (all targeting arrays empty) is fetched explicitly.
      let data: any[] | null = null;
      let error: any = null;
      {
        const [rTargeted, rGeo, rGlobal] = await Promise.all([runTargetedQuery(), runGeoQuery(), runGlobalQuery()]);
        gfxLogCapped('fetchCounts', {
          targeted: (rTargeted as any)?.data?.length ?? 0,
          geo: (rGeo as any)?.data?.length ?? 0,
          global: (rGlobal as any)?.data?.length ?? 0,
        });
        gfxLogCapped('userGeo', {
          normalizedUserState,
          normalizedUserStateId: resolvedUserStateId,
          normalizedUserParty,
          userLoksabhaId,
          userAssemblyId,
          userGroupTagsCount: userGroupTags.length,
        });
        const errs = [rTargeted?.error, rGeo?.error, rGlobal?.error].filter(Boolean);
        error = errs[0] ?? null;
        const merged = [...(rTargeted?.data ?? []), ...(rGeo?.data ?? []), ...(rGlobal?.data ?? [])] as any[];
        // Deduplicate by id
        const byId = new Map<string, any>();
        for (const row of merged) {
          const id = String(row?.id ?? '').trim();
          if (!id) continue;
          if (!byId.has(id)) byId.set(id, row);
        }
        data = Array.from(byId.values());
      }

      if (reqId !== fetchPostsReqIdRef.current) return;
      if (error) {
        setFetchError(error.message);
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
      const filtered = raw.filter((p) => {
        // Always treat NULL/undefined targeting columns as empty arrays.
        const postStates = toStrArr((p as any).state ?? []).map((s) => normalizeForCompare(s));
        const postParties = toStrArr((p as any).party ?? []).map((pa) => normalizeForCompare(normalizePartyId(pa) || pa));
        const postLoksabhas = toStrArr((p as any).loksabha ?? []).map((x) => String(x).trim()).filter(Boolean);
        const postAssemblies = toStrArr((p as any).assembly ?? []).map((x) => String(x).trim()).filter(Boolean);
        const postTargetGroups = toStrArr((p as any).target_groups ?? []).map((x) => String(x).trim()).filter(Boolean);

        /**
         * Priority rule (must match admin behavior):
         * - If `post.target_groups` is set (non-empty), it OVERRIDES geo targeting.
         *   Only show to users whose `profiles.group_tags` intersects the post target groups.
         * - Otherwise, apply geo targeting (state/party/loksabha/assembly) with "empty means global".
         */
        // Force match (requested)
        const isTargetedMatch =
          ((p as any).target_groups?.length > 0 && userInfoRef.current?.group_tags?.length > 0)
            ? ((p as any).target_groups as unknown[]).some((tg) =>
                (userInfoRef.current!.group_tags as string[]).includes(String(tg))
              )
            : false;

        if (postTargetGroups.length > 0) {
          const userProfile = userInfoRef.current ?? ({} as any);
          const userTags = Array.isArray((userProfile as any).group_tags)
            ? ((userProfile as any).group_tags as unknown[]).map((x) => String(x).trim()).filter(Boolean)
            : [];

          if (userTags.length === 0) return false;
          const userSet = new Set(userTags.map((x) => x.toLowerCase()));
          return isTargetedMatch || postTargetGroups.some((tg) => userSet.has(String(tg).toLowerCase()));
        }

        // B) Geography/Party fallback (when target_groups empty)
        // If all targeting arrays are empty, treat as global (show to all)
        const isFullyGlobal =
          postTargetGroups.length === 0 &&
          postStates.length === 0 &&
          postParties.length === 0 &&
          postLoksabhas.length === 0 &&
          postAssemblies.length === 0;
        if (isFullyGlobal) return true;

        // State targeting:
        // - If post state list is empty => global.
        // - If post states look like numeric IDs, compare against user's mapped state_id.
        // - Otherwise compare against normalized state name.
        const postStatesAreIds = postStates.length > 0 && postStates.every((s) => /^[0-9]+$/.test(String(s)));
        const isStateMatch =
          postStates.length === 0 ||
          // If post uses numeric IDs but we couldn't resolve user's state_id, don't block everything.
          (postStatesAreIds && !resolvedUserStateId) ||
          postStates.some((s) => String(s) === String(resolvedUserStateId)) ||
          (!resolvedUserStateId && (!normalizedUserState || postStates.includes(normalizedUserState)));
        if (!isStateMatch) return false;

        // Party: if post.party is empty => all parties. Otherwise must include user's party.
        // Same rule for party: if user party missing, don't block.
        const partyMatch = postParties.length === 0 || !normalizedUserParty || postParties.includes(normalizedUserParty);
        if (!partyMatch) return false;

        // Lok Sabha targeting: if post is targeted but user has no loksabha_id, don't block.
        // (User profile may be incomplete; they should still see state/party matched content.)
        if (postLoksabhas.length > 0) {
          const userLokId = userLoksabhaId == null ? '' : String(userLoksabhaId).trim();
          if (userLokId && !postLoksabhas.includes(userLokId)) return false;
        }

        // Assembly targeting: same rule as Lok Sabha.
        if (postAssemblies.length > 0) {
          const userAsmId = userAssemblyId == null ? '' : String(userAssemblyId).trim();
          if (userAsmId && !postAssemblies.includes(userAsmId)) return false;
        }

        return true;
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
      const normalizedUserState = normalizeForCompare((userInfo?.state ?? '').trim());
      const normalizedUserParty = normalizeForCompare(
        normalizePartyId((userInfo?.partyName ?? '').trim()) || (userInfo?.partyName ?? '').trim()
      );
      const userGroupTags = Array.isArray(userInfo?.group_tags)
        ? userInfo.group_tags.map((x) => String(x).trim()).filter(Boolean)
        : [];

      const runTargeted = async () => {
        if (userGroupTags.length === 0) return { data: [], error: null } as any;
        return await supabase
          .from('events')
          .select('name, end, party, state, loksabha, assembly, target_groups')
          .overlaps('target_groups', userGroupTags);
      };
      const runGeo = async () => {
        let q = supabase
          .from('events')
          .select('name, end, party, state, loksabha, assembly, target_groups')
          .or('target_groups.is.null,target_groups.eq.{}');
        // NOTE: Avoid DB-side geo filters here; NULL/empty targeting must remain eligible (treated as global on client).
        return await q;
      };
      const runGlobal = async () => {
        return await supabase
          .from('events')
          .select('name, end, party, state, loksabha, assembly, target_groups')
          .eq('state', '{}')
          .eq('party', '{}')
          .eq('loksabha', '{}')
          .eq('assembly', '{}')
          .eq('target_groups', '{}');
      };

      const [rT, rG, rAll] = await Promise.all([runTargeted(), runGeo(), runGlobal()]);
      const error = (rT as any).error ?? (rG as any).error ?? (rAll as any).error ?? null;
      if (error) {
        setFetchError((prev) => prev ?? error.message);
        setEvents([]);
        return;
      }
      const merged = [...(((rT as any).data ?? []) as any[]), ...(((rG as any).data ?? []) as any[]), ...(((rAll as any).data ?? []) as any[])]
        .filter(Boolean);
      const byName = new Map<string, any>();
      for (const row of merged) {
        const name = String(row?.name ?? '').trim();
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, row);
      }
      const raw = Array.from(byName.values()) as any[];
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const filteredEvents = raw
        .filter((ev) => {
          // targeting filter (same priority rules as posts)
          const evTargetGroups = toStrArr(ev?.target_groups);
          const evStates = toStrArr(ev?.state).map((s) => normalizeForCompare(s));
          const evParties = toStrArr(ev?.party).map((p) => normalizeForCompare(normalizePartyId(p) || p));
          const evLoksabha = toStrArr(ev?.loksabha).map((x) => String(x).trim()).filter(Boolean);
          const evAssembly = toStrArr(ev?.assembly).map((x) => String(x).trim()).filter(Boolean);

          if (evTargetGroups.length > 0) {
            if (userGroupTags.length === 0) return false;
            const userSet = new Set(userGroupTags.map((x) => x.toLowerCase()));
            if (!evTargetGroups.some((tg) => userSet.has(String(tg).toLowerCase()))) return false;
          } else {
            const isFullyGlobal =
              evTargetGroups.length === 0 &&
              evStates.length === 0 &&
              evParties.length === 0 &&
              evLoksabha.length === 0 &&
              evAssembly.length === 0;
            if (!isFullyGlobal) {
              const stateOk = evStates.length === 0 || (!!normalizedUserState && evStates.includes(normalizedUserState));
              if (!stateOk) return false;
              const partyOk = evParties.length === 0 || (!!normalizedUserParty && evParties.includes(normalizedUserParty));
              if (!partyOk) return false;
              if (evLoksabha.length > 0) {
                const userLokId = userInfo?.loksabha_id == null ? '' : String(userInfo.loksabha_id).trim();
                if (!userLokId || !evLoksabha.includes(userLokId)) return false;
              }
              if (evAssembly.length > 0) {
                const userAsmId = userInfo?.assembly_id == null ? '' : String(userInfo.assembly_id).trim();
                if (!userAsmId || !evAssembly.includes(userAsmId)) return false;
              }
            }
          }
          return true;
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
        await fetchUserProfile();
        if (cancelled) return;
      } else {
        // keep latest profile in sync (best-effort) but don't block UI
        void fetchUserProfile();
      }

      // If profile still loading and not timed out, don't fetch targeted/geo posts yet.
      if (isProfileLoading && !profileFetchTimedOut) return;

      const state = (userInfoRef.current?.state ?? '').trim();
      const party = (userInfoRef.current?.partyName ?? '').trim();
      await fetchPosts(state, party);
      if (!cancelled) setDashboardProfileLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    refreshKey,
    isProfileLoading,
    profileFetchTimedOut,
    normalizedUserStateId,
    (userInfo as any)?.group_tags,
    userInfo?.state,
    userInfo?.partyName,
    fetchUserProfile,
    fetchPosts,
  ]);

  useEffect(() => {
    if (!authReady || !dashboardProfileLoaded) {
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
    void fetchUserProfile();
    setRefreshKey((p) => p + 1);
  }, [fetchUserProfile]);

  useEffect(() => {
    if (!authReady) return;
    if (isProfileLoading && !profileFetchTimedOut) return;
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
  }, [authReady, isProfileLoading, fetchEvents]);

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
                    await fetchPosts((userInfo?.state ?? '').trim(), (userInfo?.partyName ?? '').trim());
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
