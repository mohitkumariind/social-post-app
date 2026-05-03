import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ViewShot from "react-native-view-shot";
import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { downloadMediaToCache } from '../../lib/mediaCache';
import { getProfessionalFileName } from '../../lib/professionalFileName';
import { supabase } from '../../lib/supabase';

const FRAME_STATIC_COLOR = Colors.primary;

/** Solid skeleton while graphics / frame URLs resolve (no blurhash placeholder). */
const IMAGE_SKELETON_BG = '#E8E8E8';

function routeParamStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  return String(v).trim();
}

function buildSnapshotFilename(params: Record<string, unknown>): string {
  const category = routeParamStr(params?.category);
  return getProfessionalFileName({ category, ext: 'jpg' }).replace(/\.jpg$/i, '');
}

function sortFramesByFileName<T extends { file_name?: unknown; url?: unknown; frame_url?: unknown }>(rows: T[]): T[] {
  // Numeric-aware collator (14 > 2)
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  const key = (r: T) => {
    // Trim sabse zaruri hai taaki hidden spaces " 14" na aaye
    const fn = String(r?.file_name ?? '').trim();
    if (fn !== '') return fn;

    // Fallback: Agar file_name missing hai
    const urlCandidate = String(r?.url ?? '').trim() || String((r as any)?.frame_url ?? '').trim();
    const u = String(urlCandidate ?? '').split('?')[0];
    const last = u ? u.split('/').pop() ?? '' : '';
    return last.trim();
  };

  const extractFrameIndex = (s: string): number | null => {
    // Prefer suffix patterns used by our uploads/backfills:
    // "<ts>-_001.png" -> 1
    // "frame_12.png" -> 12
    // "12.png" -> 12
    // Fallback: last number anywhere in the string.
    const base = s.split('?')[0].trim().replace(/\.[a-z0-9]+$/i, '');
    const suffix = base.match(/(?:^|[^0-9])(?:-|_)+0*(\d+)$/);
    if (suffix?.[1]) {
      const n = Number(suffix[1]);
      return Number.isFinite(n) ? n : null;
    }
    const lastNum = base.match(/(\d+)(?!.*\d)/);
    if (!lastNum?.[1]) return null;
    const n = Number(lastNum[1]);
    return Number.isFinite(n) ? n : null;
  };

  const sorted = [...rows].sort((a, b) => {
    const keyA = key(a);
    const keyB = key(b);

    // Prefer numeric ordering when a frame number exists.
    const numA = extractFrameIndex(keyA);
    const numB = extractFrameIndex(keyB);
    if (numA != null && numB != null && numA !== numB) return numA - numB;
    if (numA != null && numB == null) return -1;
    if (numA == null && numB != null) return 1;

    // If both don't have a numeric index, fall back to created_at when available.
    const aCreated = Date.parse(String((a as any)?.created_at ?? ''));
    const bCreated = Date.parse(String((b as any)?.created_at ?? ''));
    if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) {
      // Newest first to match the admin list & expected recency behavior.
      return bCreated - aCreated;
    }

    // Fallback to collator (handles "14" vs "2" and general string order)
    const c = collator.compare(keyA, keyB);
    if (c !== 0) return c;
    // Stable-ish tie-breaker to avoid random flips
    return collator.compare(String(a?.url ?? ''), String(b?.url ?? ''));
  });

  return sorted;
}

/** Normalize `posts.captions` / `events.captions` (jsonb, text JSON string, or plain string). */
function parseCaptionsFromDb(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === 'string' ? x.trim() : x != null ? String(x).trim() : ''))
      .filter((s) => s.length > 0);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || s === '[]') return [];
    try {
      const p = JSON.parse(s) as unknown;
      if (Array.isArray(p)) {
        return p.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0);
      }
      if (typeof p === 'string' && p.trim()) return [p.trim()];
    } catch {
      return [s];
    }
  }
  return [];
}

type MediaKind = 'daily' | 'frame';

function useCachedMediaUri(opts: { kind: MediaKind; url: string | null | undefined; ext?: string }) {
  const url = typeof opts.url === 'string' ? opts.url.trim() : '';
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setLocalUri(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const uri = await downloadMediaToCache({ kind: opts.kind, url, ext: opts.ext });
        if (!cancelled) setLocalUri(uri);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.kind, url, opts.ext]);

  return { uri: localUri || url || null, loading };
}

function CachedMediaImage({
  kind,
  url,
  style,
  contentFit,
}: {
  kind: MediaKind;
  url: string;
  style?: any;
  contentFit?: 'cover' | 'contain';
}) {
  const { uri, loading } = useCachedMediaUri({ kind, url });
  // Frames are transparent PNG overlays; a grey skeleton behind them makes the poster look "greyed out".
  const showSkeleton = kind !== 'frame';
  return (
    <View style={[style, { backgroundColor: showSkeleton ? IMAGE_SKELETON_BG : 'transparent' }]}>
      {loading && showSkeleton ? (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: IMAGE_SKELETON_BG }]} />
      ) : null}
      <ExpoImage
        source={{ uri: String(uri || url) }}
        style={StyleSheet.absoluteFillObject}
        contentFit={contentFit ?? 'contain'}
        cachePolicy="disk"
      />
    </View>
  );
}

export default function PostDetailScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t } = useLang();
  const { userInfo } = useUser();
  const viewShotRefs = useRef<Record<number, any>>({});
  const captureIndexRef = useRef<number>(0);
  const lastCaptureDiagRef = useRef<string>('');

  const initialIndex = params?.currentIndex != null ? parseInt(String(params.currentIndex), 10) : 0;

  const [frames, setFrames] = useState<any[]>([]);
  const [selectedFrame, setSelectedFrame] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [dynamicCaptions, setDynamicCaptions] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backNavLockRef = useRef(false);
  const isMountedRef = useRef(true);
  const isNavigatingAwayRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      isNavigatingAwayRef.current = true;
      // Ensure refs don't keep native views alive after unmount.
      viewShotRefs.current = {};
      captureIndexRef.current = 0;
      backNavLockRef.current = false;
    };
  }, []);

  const goBackToExpandedCategory = useCallback(() => {
    if (backNavLockRef.current) return true;
    backNavLockRef.current = true;
    isNavigatingAwayRef.current = true;
    // Safety unlock: if navigation is interrupted, allow retry instead of white screen lock.
    setTimeout(() => {
      backNavLockRef.current = false;
      isNavigatingAwayRef.current = false;
    }, 1200);
    const categoryRaw = params?.category;
    const category =
      typeof categoryRaw === 'string'
        ? categoryRaw
        : Array.isArray(categoryRaw)
          ? categoryRaw[0]
          : undefined;
    if (category && category.trim().length > 0) {
      router.replace({
        pathname: '/(tabs)/dashboard',
        params: { expandCategory: category, expandTab: 'graphics' },
      });
    } else {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/dashboard');
    }
    return true;
  }, [params?.category, router]);

  const originalData: string[] = useMemo(() => {
    try {
      const filterUrl = (u: unknown): u is string =>
        u != null && typeof u === 'string' && String(u).trim().length > 0;
      if (params?.images && typeof params.images === 'string') {
        const parsed = JSON.parse(params.images);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.filter(filterUrl);
        }
      }
      if (params?.image != null && typeof params.image === 'string') {
        const img = String(params.image).trim();
        if (img.length > 0) return [img];
      }
    } catch {
      if (__DEV__) console.warn('PostDetail originalData parse error');
    }
    return [];
  }, [params?.images, params?.image]);

  const infiniteData = useMemo(() => {
    if (originalData.length <= 1) return originalData;
    return [...originalData, ...originalData, ...originalData];
  }, [originalData]);

  useEffect(() => {
    try {
      const total = originalData.length;
      const jumpTo = total > 1 ? total + initialIndex : 0;
      setActiveIndex(jumpTo);
      const timer = setTimeout(() => {
        try {
          scrollRef.current?.scrollTo({ x: jumpTo * width, animated: false });
          if (isMountedRef.current) setIsReady(true);
        } catch {
          if (isMountedRef.current) setIsReady(true);
        }
      }, 400);
      return () => clearTimeout(timer);
    } catch (e) {
      if (isMountedRef.current) setIsReady(true);
    }
  }, [originalData, initialIndex]);

  useEffect(() => {
    let cancelled = false;
    const fetchFrames = async () => {
      try {
        // On some devices/screens, auth restore may lag behind navigation.
        // Retry a few times before giving up to avoid "no frames" due to missing uid.
        let uid: string | undefined;
        for (let i = 0; i < 5; i++) {
          const { data: sessionData } = await supabase.auth.getSession();
          uid = sessionData?.session?.user?.id;
          if (uid) break;
          const { data: authData } = await supabase.auth.getUser();
          uid = authData?.user?.id;
          if (uid) break;
          await new Promise((r) => setTimeout(r, 400));
          if (cancelled) return;
        }
        if (!uid) {
          if (!cancelled && __DEV__) console.warn('[PostDetail] fetchFrames: missing user id');
          return;
        }

        const { data, error } = await supabase
          .from('user_frames')
          .select('*')
          .eq('user_id', uid)
          .order('file_name', { ascending: true });
        if (cancelled) return;
        if (error) {
          if (!cancelled && __DEV__) console.warn('[PostDetail] fetchFrames error:', error.message);
          return;
        }
        if (data && isMountedRef.current) setFrames(sortFramesByFileName(data as any[]));
      } catch (e) {
      if (!cancelled && __DEV__) console.warn('fetchFrames exception');
      }
    };
    fetchFrames();
    return () => { cancelled = true; };
  }, []);

  const isStaticFrame = selectedFrame === 1;
  const displayName =
    String(userInfo?.name ?? '').trim().toUpperCase() ||
    String(t('default_user_name') ?? '').trim().toUpperCase();
  const displayDesignation =
    String(userInfo?.designation1 ?? '').trim() || String(t('default_designation') ?? '').trim();
  const avatarUrl = String(userInfo?.avatar_url ?? '').trim();

  const overlayUrl =
    selectedFrame >= 2 && selectedFrame - 2 < frames.length
      ? (frames[selectedFrame - 2]?.url || frames[selectedFrame - 2]?.frame_url || null)
      : null;

  const alertSafe = (title: string | undefined | null, message: string | undefined | null) => {
    const tt = String(title ?? '').trim();
    const mm = String(message ?? '').trim();
    Alert.alert(tt || 'Notice', mm || 'Please try again.');
  };

  const getBestViewShot = (): any | null => {
    const map = viewShotRefs.current;
    const idx = captureIndexRef.current;
    if (map[idx]) return map[idx];
    if (map[activeIndex]) return map[activeIndex];
    const keys = Object.keys(map)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n));
    if (keys.length === 0) return null;
    keys.sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx));
    return map[keys[0]] ?? null;
  };

  const resolveUniqueSnapshotDest = async (opts: {
    dir: string;
    filenameBase: string;
    ext: string;
  }): Promise<{ dest: string; filename: string }> => {
    // Common failure mode on real phones: user taps save/share multiple times within the same minute.
    // Our professional filename helper is minute-granular → the destination already exists → copyAsync throws.
    for (let i = 0; i < 50; i++) {
      const suffix = i === 0 ? '' : `_${i}`;
      const filename = `${opts.filenameBase}${suffix}.${opts.ext}`;
      const dest = `${opts.dir}${filename}`;
      const info = await FileSystem.getInfoAsync(dest);
      if (!info.exists) return { dest, filename };
    }
    // Fall back to a timestamped suffix as a last resort.
    const filename = `${opts.filenameBase}_${Date.now()}.${opts.ext}`;
    return { dest: `${opts.dir}${filename}`, filename };
  };

  const captureSnapshotToNamedFile = async (): Promise<{ uri: string; filename: string } | null> => {
    lastCaptureDiagRef.current = '';
    const shotRef = getBestViewShot();
    if (!shotRef) {
      lastCaptureDiagRef.current = 'step=getBestViewShot\nerror=no ViewShot ref (not mounted yet)';
      return null;
    }
    const filenameBase = buildSnapshotFilename(params as unknown as Record<string, unknown>);
    const ext = 'jpg';
    const fallbackFilename = `${filenameBase}.${ext}`;

    try {
      const rawUri: string = await shotRef.capture();
      if (!rawUri || typeof rawUri !== 'string') {
        lastCaptureDiagRef.current = `step=ViewShot.capture\nerror=invalid capture uri (${String(rawUri)})`;
        return null;
      }
      const cacheDir: string | null =
        (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory ?? null;

      // If cacheDirectory is unavailable on this runtime/device, do not block share/save.
      // Use the raw capture URI and keep professional name only for the share sheet title.
      if (!cacheDir) {
        lastCaptureDiagRef.current = 'step=FileSystem.cacheDirectory\nwarn=cache directory unavailable; using rawUri';
        return { uri: rawUri, filename: fallbackFilename };
      }

      const dir = `${cacheDir}snapshots/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const { dest, filename } = await resolveUniqueSnapshotDest({ dir, filenameBase, ext });

      // Create a stable, user-friendly filename for share sheets / downloads.
      // Some Android devices/providers may return a URI that cannot be copied; in that case fall back to rawUri.
      try {
        await FileSystem.copyAsync({ from: rawUri, to: dest });
        return { uri: dest, filename };
      } catch (copyErr) {
        try {
          await FileSystem.moveAsync({ from: rawUri, to: dest });
          return { uri: dest, filename };
        } catch {
          if (__DEV__) console.warn('[PostDetail] copy/move snapshot failed, using rawUri', copyErr);
          return { uri: rawUri, filename: fallbackFilename };
        }
      }
    } catch (e) {
      if (__DEV__) console.warn('[PostDetail] captureSnapshotToNamedFile failed', e);
      const details =
        e instanceof Error
          ? `${e.name}: ${e.message}`
          : typeof e === 'object' && e != null
            ? JSON.stringify(e)
            : String(e ?? '');
      lastCaptureDiagRef.current = `step=captureSnapshotToNamedFile\nerror=${details || 'unknown'}`;
      return null;
    }
  };

  const handleDownload = async () => {
      if (!isMountedRef.current || isNavigatingAwayRef.current || isDownloading || isSharing) return;
    try {
      setIsDownloading(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        alertSafe(t('permission_required') || 'Permission required', t('permission_message') || 'Please allow access to save images.');
        return;
      }

      // Android 10 friendly: avoid FileSystem path manipulation.
      const shotRef = getBestViewShot();
      if (!shotRef) {
        alertSafe(t('save_error_title') || 'Save failed', 'Capture not ready. Please try again.');
        return;
      }
      const rawUri: string = await shotRef.capture();
      if (!rawUri || typeof rawUri !== 'string') {
        alertSafe(t('save_error_title') || 'Save failed', t('save_error_message') || 'Something went wrong while saving.');
        return;
      }

      await MediaLibrary.saveToLibraryAsync(rawUri);
      alertSafe(t('save_success_title') || 'Saved', t('save_success_message') || 'Saved to gallery.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error ?? '');
      alertSafe(t('save_error_title') || 'Save failed', msg || t('save_error_message') || 'Something went wrong while saving.');
    } finally {
      if (isMountedRef.current) setIsDownloading(false);
    }
  };

  const handleShare = async () => {
      if (!isMountedRef.current || isNavigatingAwayRef.current || isSharing || isDownloading) return;
    let lastUri: string | null = null;
    let lastFilename: string | null = null;
    try {
      setIsSharing(true);
      const named = await captureSnapshotToNamedFile();
      if (!named) {
        const diag = lastCaptureDiagRef.current;
        alertSafe(t('save_error_title') || 'Share failed', diag || t('save_error_message') || 'Something went wrong while sharing.');
        return;
      }
      lastUri = named.uri;
      lastFilename = named.filename;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(named.uri, { dialogTitle: named.filename, mimeType: 'image/jpeg' });
      } else {
        Share.share({ message: t('share_message') });
      }
    } catch (e) {
      if (__DEV__) console.warn('share failed', e);
      const msg = e instanceof Error ? e.message : String(e ?? '');
      const details =
        msg ||
        (typeof e === 'object' && e != null ? JSON.stringify(e) : String(e ?? '')) ||
        '';
      const diag = `step=Sharing.shareAsync\nuri=${lastUri ?? 'n/a'}\nfile=${lastFilename ?? 'n/a'}\nerror=${details || 'unknown'}`;
      alertSafe(t('save_error_title') || 'Share failed', diag);
    } finally {
      if (isMountedRef.current) setIsSharing(false);
    }
  };

  const handleScrollEnd = (event: any) => {
    const xOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(xOffset / width);
    const total = originalData.length;
    if (total <= 1) return;
    if (index < total) {
      const newIdx = index + total;
      scrollRef.current?.scrollTo({ x: newIdx * width, animated: false });
      setActiveIndex(newIdx);
    } else if (index >= total * 2) {
      const newIdx = index - total;
      scrollRef.current?.scrollTo({ x: newIdx * width, animated: false });
      setActiveIndex(newIdx);
    } else {
      setActiveIndex(index);
    }
  };

  const FRAME_COLORS: Record<number, string> = {
    1: FRAME_STATIC_COLOR,
    2: '#2ECC71',
    3: '#1A73E8',
    4: '#E74C3C',
    5: '#8E44AD',
    6: '#2C3E50',
  };
  const visibleFrameIds = useMemo(() => [1, ...frames.map((_, i) => i + 2)], [frames]);
  const visibleFrames = useMemo(
    () => [
      { id: 1, color: FRAME_STATIC_COLOR, url: null as string | null },
      ...frames.map((f, i) => ({
        id: i + 2,
        color: FRAME_COLORS[i + 2] ?? '#333',
        url: (f.url || f.frame_url || '') as string,
      })),
    ],
    [frames]
  );

  useEffect(() => {
    if (!visibleFrameIds.includes(selectedFrame)) setSelectedFrame(1);
  }, [visibleFrameIds, selectedFrame]);

  const captionsToRender = dynamicCaptions;

  useEffect(() => {
    // Dashboard may send `captions` (array JSON) or older `caption` key by mistake.
    const raw = (params as any)?.captions ?? (params as any)?.caption;
    const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
    if (!value) {
      setDynamicCaptions([]);
      return;
    }
    const v = value.trim();
    if (!v) {
      setDynamicCaptions([]);
      return;
    }
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) {
        const list = parsed
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0);
        setDynamicCaptions(list);
        return;
      }
      if (typeof parsed === 'string' && parsed.trim()) {
        setDynamicCaptions([parsed.trim()]);
        return;
      }
      setDynamicCaptions([v]);
    } catch {
      // Not JSON (or invalid JSON) → treat as plain caption text.
      setDynamicCaptions([v]);
    }
  }, [(params as any)?.captions, (params as any)?.caption]);

  /**
   * If route params lose/truncate `captions` (common with long JSON in URLs), load from DB.
   * Prefer `postId` → `posts.image_url` → `events.name` (category).
   */
  useEffect(() => {
    if (dynamicCaptions.length > 0) return;
    const postId = routeParamStr((params as any)?.postId);
    const imageUrl = routeParamStr((params as any)?.image);
    const category = routeParamStr((params as any)?.category);
    if (!postId && !imageUrl && !category) return;
    let cancelled = false;
    (async () => {
      try {
        if (postId) {
          const { data, error } = await supabase.from('posts').select('captions').eq('id', postId).maybeSingle();
          if (cancelled) return;
          if (error && __DEV__) console.warn('[PostDetail] postId captions error:', error.message);
          if (!error && data) {
            const list = parseCaptionsFromDb((data as { captions?: unknown }).captions);
            if (list.length > 0) {
              setDynamicCaptions(list);
              return;
            }
          }
        }

        if (imageUrl) {
          const { data, error } = await supabase.from('posts').select('captions').eq('image_url', imageUrl).maybeSingle();
          if (cancelled) return;
          if (error && __DEV__) console.warn('[PostDetail] image_url captions error:', error.message);
          if (!error && data) {
            const list = parseCaptionsFromDb((data as { captions?: unknown }).captions);
            if (list.length > 0) {
              setDynamicCaptions(list);
              return;
            }
          }
        }

        if (!category) return;
        const { data: evRows, error: evErr } = await supabase
          .from('events')
          .select('captions')
          .eq('name', category)
          .limit(1);
        if (cancelled) return;
        if (evErr) {
          if (__DEV__) console.warn('[PostDetail] events captions error:', evErr.message);
          return;
        }
        const evRaw = (evRows?.[0] as { captions?: unknown } | undefined)?.captions;
        const list = parseCaptionsFromDb(evRaw);
        if (list.length > 0) setDynamicCaptions(list);
      } catch (e) {
        if (__DEV__) console.warn('[PostDetail] captions fallback exception', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dynamicCaptions.length, params?.postId, params?.image, params?.category]);

  const handleCopyCaption = useCallback(
    async (text: string) => {
      if (!text?.trim()) return;
      await Clipboard.setStringAsync(text);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (isMountedRef.current) setShowCopiedToast(true);
      toastTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) setShowCopiedToast(false);
        toastTimerRef.current = null;
      }, 2000);
    },
    []
  );

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBackToExpandedCategory);
    return () => sub.remove();
  }, [goBackToExpandedCategory]);

  if (originalData.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBackToExpandedCategory} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('ready_to_post')} 🚀</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBackToExpandedCategory} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('ready_to_post')} 🚀</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={{ opacity: isReady ? 1 : 0 }}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScrollEnd}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset?.x ?? 0;
              const idx = Math.round(x / width);
              captureIndexRef.current = idx;
            }}
            scrollEventThrottle={16}
          >
            {infiniteData.map((item, index) => (
              <View key={`${item}-${index}`} style={[styles.slideWrapper, { width }]}>
                <ViewShot
                  ref={(ref) => {
                    if (ref) viewShotRefs.current[index] = ref;
                    else delete viewShotRefs.current[index];
                  }}
                  options={{
                    format: 'jpg',
                    quality: 1.0,
                    width: 1080,
                    height: 1350,
                  }}
                >
                  <View
                    style={[
                      styles.mediaContainer,
                      { width: width - 20, aspectRatio: 4 / 5 },
                      isStaticFrame && { overflow: 'visible' as const },
                    ]}
                  >
                    <View style={styles.mediaDragWrapper}>
                      {item && typeof item === 'string' ? (
                        <CachedMediaImage kind="daily" url={item} style={styles.fullMedia} contentFit="contain" />
                      ) : (
                        <View style={[styles.fullMedia, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
                          <ActivityIndicator size="small" color="#FFF" />
                        </View>
                      )}
                    </View>
                    {isStaticFrame && (
                      <View style={styles.frameOverlay}>
                        <View style={[styles.textBlockCentered, !avatarUrl && styles.textBlockCenteredFullWidth]}>
                          <Text style={styles.userName} numberOfLines={1}>
                            {displayName}
                          </Text>
                          <Text style={styles.userDesignation} numberOfLines={1}>
                            {displayDesignation}
                          </Text>
                        </View>

                        <View style={styles.avatarDock}>
                          {avatarUrl ? (
                            <View style={styles.userPhotoActual}>
                              <ExpoImage
                                source={{ uri: avatarUrl }}
                                style={StyleSheet.absoluteFillObject}
                                contentFit="cover"
                                cachePolicy="disk"
                              />
                            </View>
                          ) : null}
                        </View>
                      </View>
                    )}
                    {overlayUrl ? (
                      <View style={styles.frameOverlayImageWrap}>
                        <CachedMediaImage kind="frame" url={overlayUrl} style={styles.frameOverlayImage} contentFit="contain" />
                      </View>
                    ) : null}
                  </View>
                </ViewShot>
              </View>
            ))}
          </ScrollView>
        </View>

        <Text style={styles.sectionTitle}>{t('select_frame')}</Text>
        <View style={styles.framesGrid}>
          {visibleFrames.map((f) => (
            <TouchableOpacity key={f.id} onPress={() => setSelectedFrame(f.id)} style={styles.frameCard}>
              {f.id === 1 ? (
                <View style={[styles.miniFrameUI, selectedFrame === f.id && { borderColor: f.color, borderWidth: 3 }]} />
              ) : (
                <View style={[styles.miniFrameUI, selectedFrame === f.id && { borderColor: f.color, borderWidth: 3 }, { overflow: 'hidden' }]}>
                  {f.url ? (
                    <CachedMediaImage
                      kind="frame"
                      url={String(f.url)}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="contain"
                    />
                  ) : null}
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t('copy_caption')}</Text>
        <View style={styles.captionList}>
          {captionsToRender.map((caption, idx) => (
            <TouchableOpacity
              key={`${idx}-${caption.slice(0, 24)}`}
              style={styles.captionCard}
              onPress={() => handleCopyCaption(caption)}
              activeOpacity={0.8}
            >
              <Text style={styles.captionCardText} numberOfLines={2}>{caption}</Text>
              <View style={styles.captionCopyBtn}>
                <Ionicons name="copy-outline" size={20} color={Colors.accent} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={styles.stickyActionCard} pointerEvents="box-none">
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={[styles.shareBtn, (isSharing || isDownloading) && { opacity: 0.7 }]} onPress={handleShare} disabled={isSharing || isDownloading}>
            <Ionicons name="logo-whatsapp" size={22} color={Colors.textOnPrimary} />
            <Text style={styles.shareBtnText}>{isSharing ? 'Sharing...' : t('share_whatsapp')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.downloadBtn, (isSharing || isDownloading) && { opacity: 0.7 }]} onPress={handleDownload} disabled={isSharing || isDownloading}>
            <Ionicons name="download-outline" size={22} color="#FFF" />
            <Text style={styles.downloadBtnText}>{isDownloading ? 'Saving...' : `${t('save_to_gallery')} ✨`}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {showCopiedToast && (
        <View style={styles.toast}>
          <Ionicons name="checkmark-circle" size={20} color="#FFF" />
          <Text style={styles.toastText}>{t('caption_copied')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: { paddingTop: 40, paddingHorizontal: 20, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingVertical: 10, paddingBottom: 220 },
  slideWrapper: { alignItems: 'center', justifyContent: 'center' },
  mediaContainer: { backgroundColor: '#000', borderRadius: 0, overflow: 'hidden', position: 'relative' },
  mediaDragWrapper: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  fullMedia: { width: '100%', height: '100%' },
  frameOverlayImageWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  frameOverlayImage: { width: '100%', aspectRatio: 4 / 5 },
  frameOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 65,
    backgroundColor: '#FCFCFC',
    borderTopWidth: 0,
    overflow: 'visible',
    padding: 0,
    margin: 0,
  },
  // Centers name + designation in the band left of the 135px avatar (rebalanced, not under the image).
  textBlockCentered: {
    position: 'absolute',
    left: 0,
    right: 135,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  textBlockCenteredFullWidth: { right: 0 },
  userPhotoActual: {
    width: 135,
    height: 135,
    borderRadius: 0,
    borderWidth: 0,
    margin: 0,
    padding: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  avatarDock: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 135,
    height: 135,
    margin: 0,
    padding: 0,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  userName: { fontSize: 16, fontWeight: '700', color: '#0F172A', textAlign: 'center' },
  userDesignation: { fontSize: 14, color: '#64748B', fontWeight: '600', textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', margin: 20 },
  framesGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15 },
  frameCard: { width: '33.33%', height: 80, padding: 6 },
  miniFrameUI: { flex: 1, borderRadius: 10, backgroundColor: '#F5F5F5', borderWidth: 2, borderColor: '#E8E8E8', overflow: 'hidden' as const },
  buttonContainer: { padding: 25, gap: 12 },
  shareBtn: { height: 55, borderRadius: 15, backgroundColor: Colors.secondary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  shareBtnText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '800' },
  downloadBtn: { height: 55, borderRadius: 15, backgroundColor: Colors.secondary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  downloadBtnText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '800' },
  captionList: { paddingHorizontal: 15, paddingBottom: 8 },
  captionCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F5F5', borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#DDD' },
  captionCardText: { flex: 1, fontSize: 14, color: '#333', fontWeight: '500', lineHeight: 20, marginRight: 12 },
  captionCopyBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E8E0FF', justifyContent: 'center', alignItems: 'center' },
  toast: { position: 'absolute', bottom: 100, left: 24, right: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.accent, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, gap: 8, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  stickyActionCard: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFF' },
});
