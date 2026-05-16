import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
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
import { CachedFrameMedia } from '../../components/frame/CachedFrameMedia';
import { FrameEngine } from '../../components/frame/FrameEngine';
import { FrameSelector } from '../../components/frame/FrameSelector';
import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { useFrameCutout } from '../../hooks/useFrameCutout';
import { getProfessionalFileName } from '../../lib/professionalFileName';
import {
  hashRenderedPostVariant,
  incrementPostDownloadEngagement,
  type PostDownloadAction,
} from '../../lib/postDownloadEngagement';
import { resolvePostIdForEngagement } from '../../lib/resolvePostIdForEngagement';
import { sortUserFramesByDisplayKey } from '../../lib/sortUserFramesByDisplayKey';
import { supabase } from '../../lib/supabase';
import { resolveUserFrameOverlayUrl } from '../../lib/userFrameUrl';
import { savePerfEnd, savePerfStart, savePerfStep } from '../../utils/savePipelinePerf';

const FRAME_STATIC_COLOR = Colors.primary;

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

/** Gallery save name: `SocialPost-[CleanName].png` (alphanumeric only in name segment). */
function buildSocialPostSaveBasename(displayName: unknown): string {
  const raw = String(displayName ?? '').trim() || 'User';
  const cleanName = raw.replace(/[^a-zA-Z0-9]/g, '') || 'User';
  return `SocialPost-${cleanName}`;
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

export default function PostDetailScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t } = useLang();
  const { userInfo } = useUser();
  const viewShotRefs = useRef<Record<number, any>>({});
  const captureIndexRef = useRef<number>(0);
  const lastCaptureDiagRef = useRef<string>('');

  // Rendered "frame" size on-screen (same aspect ratio as ViewShot: 1080x1350 => 4/5).
  const frameRenderWidth = width - 20;
  const frameRenderHeight = (frameRenderWidth * 5) / 4;

  // Dynamic micro-strip sizing derived from rendered frame height.
  const STRIP_HEIGHT = frameRenderHeight * 0.03; // 3% of frame height
  const CONTENT_SIZE = frameRenderHeight * 0.0182; // 30% smaller than 0.026

  // Dynamic text sizing derived from rendered frame height.
  const NAME_SIZE = frameRenderHeight * 0.052; // requested
  const DESIGNATION_SIZE = frameRenderHeight * 0.035;

  const initialIndex = useMemo(() => {
    const raw = params?.currentIndex != null ? parseInt(String(params.currentIndex), 10) : 0;
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  }, [params?.currentIndex]);

  const [frames, setFrames] = useState<any[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<number>(1);
  const selectedFrameNum = Number(selectedFrame);
  const safeSelectedFrame = Number.isFinite(selectedFrameNum) && selectedFrameNum > 0 ? selectedFrameNum : 1;

  const [frameLayoutVariant, setFrameLayoutVariant] = useState<1 | 2>(1);
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
  const engagementPostIdRef = useRef('');

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
      const clampedInitial = total > 0 ? Math.min(Math.max(0, initialIndex), total - 1) : 0;
      const jumpTo = total > 1 ? total + clampedInitial : 0;
      // IMPORTANT: `mountComposer` keys off `activeIndex`. Do not set `activeIndex` to `jumpTo`
      // until after `scrollTo` — otherwise the on-screen slide (still at offset 0 for ~400ms)
      // mounts no FrameEngine and frames look "missing" for every user.
      const timer = setTimeout(() => {
        try {
          scrollRef.current?.scrollTo({ x: jumpTo * width, animated: false });
          if (isMountedRef.current) {
            setActiveIndex(jumpTo);
            setIsReady(true);
          }
        } catch {
          if (isMountedRef.current) {
            setActiveIndex(jumpTo);
            setIsReady(true);
          }
        }
      }, 400);
      return () => clearTimeout(timer);
    } catch (e) {
      if (isMountedRef.current) setIsReady(true);
    }
  }, [originalData, initialIndex, width]);

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

        const { data, error } = await supabase.from('user_frames').select('*').eq('user_id', uid);
        if (cancelled) return;
        if (error) {
          if (!cancelled && __DEV__) console.warn('[PostDetail] fetchFrames error:', error.message);
          return;
        }
        if (data && isMountedRef.current) {
          const sorted = sortUserFramesByDisplayKey(data as any[]);
          if (__DEV__) {
            console.log('[frame-profile-debug] user_frames fetch', {
              rowCount: sorted.length,
              sampleUrls: sorted.slice(0, 3).map((r) => resolveUserFrameOverlayUrl(r)),
            });
          }
          setFrames(sorted);
        }
      } catch (e) {
      if (!cancelled && __DEV__) console.warn('fetchFrames exception');
      }
    };
    fetchFrames();
    return () => { cancelled = true; };
  }, []);

  const displayName = String(userInfo?.name ?? '');
  const avatarUrl = String(userInfo?.avatar_url ?? '').trim();
  const { frameCutoutUri, frameAvatarSlotMode, setFrameAvatarSlotMode, setFrameCutoutUri } = useFrameCutout(avatarUrl);

  useEffect(() => {
    if (safeSelectedFrame === 1 || safeSelectedFrame === 2) {
      setFrameLayoutVariant(safeSelectedFrame as 1 | 2);
    }
  }, [safeSelectedFrame]);

  const useFrameChromeOverflow = safeSelectedFrame === 1 || safeSelectedFrame === 2 || safeSelectedFrame >= 3;
  const staticChromeSide = frameLayoutVariant === 2 ? ('left' as const) : ('right' as const);

  const filledDesignations = useMemo(() => {
    const raw = [
      userInfo?.designation1,
      userInfo?.designation2,
      userInfo?.designation3,
      userInfo?.designation4,
    ];
    const values = raw.map((x) => String(x ?? ''));
    // Keep rendering "as typed", but don't render blank/whitespace-only lines.
    return values.filter((s) => s.trim().length > 0);
  }, [userInfo?.designation1, userInfo?.designation2, userInfo?.designation3, userInfo?.designation4]);

  const overlayRow =
    safeSelectedFrame >= 3 && safeSelectedFrame - 3 < frames.length ? frames[safeSelectedFrame - 3] : null;
  const overlayUrl = overlayRow ? resolveUserFrameOverlayUrl(overlayRow) : null;

  useEffect(() => {
    if (!__DEV__) return;
    const row =
      safeSelectedFrame >= 3 && safeSelectedFrame - 3 < frames.length ? frames[safeSelectedFrame - 3] : null;
    const url = row ? resolveUserFrameOverlayUrl(row) : '';
    console.log('[frame-profile-debug] selection', {
      safeSelectedFrame,
      framesLen: frames.length,
      hasOverlayRow: !!row,
      overlayUrlPreview: url ? `${url.slice(0, 80)}…` : '',
    });
  }, [safeSelectedFrame, frames]);

  useEffect(() => {
    if (!__DEV__) return;
    console.log('[frame-profile-debug] carousel activeIndex', activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    let cancelled = false;
    const n = originalData.length;
    const slideIdx = n > 0 ? ((activeIndex % n) + n) % n : 0;
    const imageUrl = originalData[slideIdx] ?? '';
    void (async () => {
      const id = await resolvePostIdForEngagement({
        routePostId: (params as any)?.postId,
        imageUrl,
      });
      if (!cancelled) engagementPostIdRef.current = id;
    })();
    return () => {
      cancelled = true;
    };
  }, [params, originalData, activeIndex]);

  const firePostDownloadEngagement = useCallback(
    async (action: PostDownloadAction) => {
      const postId = engagementPostIdRef.current || routeParamStr((params as any)?.postId);
      if (!postId) return;
      const n = originalData.length;
      const slideIdx = n > 0 ? ((activeIndex % n) + n) % n : 0;
      const imageUrl = originalData[slideIdx] ?? '';
      savePerfStep('engagement.prepare');
      const hash = await hashRenderedPostVariant({
        postId,
        selectedFrame: safeSelectedFrame,
        overlayUrl: String(overlayUrl ?? ''),
        frameLayoutVariant,
        imageUrl,
      });
      await incrementPostDownloadEngagement({ postId, action, renderedVariantHash: hash });
    },
    [params, activeIndex, originalData, safeSelectedFrame, overlayUrl, frameLayoutVariant]
  );

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
    savePerfStep('capture.getViewShotRef');
    const shotRef = getBestViewShot();
    if (!shotRef) {
      lastCaptureDiagRef.current = 'step=getBestViewShot\nerror=no ViewShot ref (not mounted yet)';
      return null;
    }
    const filenameBase = buildSnapshotFilename(params as unknown as Record<string, unknown>);
    const ext = 'jpg';
    const fallbackFilename = `${filenameBase}.${ext}`;

    try {
      savePerfStep('capture.viewShot.start', { format: 'jpg', w: 1080, h: 1350 });
      const capT0 = performance.now();
      const rawUri: string = await shotRef.capture();
      savePerfStep('capture.viewShot.done', { ms: Math.round(performance.now() - capT0) });
      if (!rawUri || typeof rawUri !== 'string') {
        lastCaptureDiagRef.current = `step=ViewShot.capture\nerror=invalid capture uri (${String(rawUri)})`;
        return null;
      }
      const cacheDir: string | null =
        FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? null;

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
        savePerfStep('capture.fileCopy.start');
        const copyT0 = performance.now();
        await FileSystem.copyAsync({ from: rawUri, to: dest });
        savePerfStep('capture.fileCopy.done', { ms: Math.round(performance.now() - copyT0) });
        return { uri: dest, filename };
      } catch (copyErr) {
        try {
          savePerfStep('capture.fileMove.start');
          const moveT0 = performance.now();
          await FileSystem.moveAsync({ from: rawUri, to: dest });
          savePerfStep('capture.fileMove.done', { ms: Math.round(performance.now() - moveT0) });
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
    savePerfStart('download', {
      slides: originalData.length,
      infiniteSlides: infiniteData.length,
      viewShotRefs: Object.keys(viewShotRefs.current).length,
      frame: safeSelectedFrame,
      hasOverlay: !!overlayUrl,
      captureIndex: captureIndexRef.current,
      activeIndex,
    });
    try {
      setIsDownloading(true);
      savePerfStep('download.permission.start');
      const permT0 = performance.now();
      const { status } = await MediaLibrary.requestPermissionsAsync();
      savePerfStep('download.permission.done', { ms: Math.round(performance.now() - permT0), status });
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
      savePerfStep('download.viewShot.start', { format: 'jpg', w: 1080, h: 1350 });
      const capT0 = performance.now();
      const rawUri: string = await shotRef.capture();
      savePerfStep('download.viewShot.done', { ms: Math.round(performance.now() - capT0) });
      if (!rawUri || typeof rawUri !== 'string') {
        alertSafe(t('save_error_title') || 'Save failed', t('save_error_message') || 'Something went wrong while saving.');
        return;
      }

      const filenameBase = buildSocialPostSaveBasename(userInfo?.name);
      const ext = 'png';
      let uriToSave = rawUri;
      const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? null;
      if (cacheDir) {
        try {
          const dir = `${cacheDir}snapshots/`;
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
          const { dest } = await resolveUniqueSnapshotDest({ dir, filenameBase, ext });
          try {
            savePerfStep('download.fileCopy.start');
            const copyT0 = performance.now();
            await FileSystem.copyAsync({ from: rawUri, to: dest });
            savePerfStep('download.fileCopy.done', { ms: Math.round(performance.now() - copyT0) });
            uriToSave = dest;
          } catch {
            savePerfStep('download.fileMove.start');
            const moveT0 = performance.now();
            await FileSystem.moveAsync({ from: rawUri, to: dest });
            savePerfStep('download.fileMove.done', { ms: Math.round(performance.now() - moveT0) });
            uriToSave = dest;
          }
        } catch (copyErr) {
          if (__DEV__) console.warn('[PostDetail] gallery named file copy failed, saving capture URI', copyErr);
        }
      }

      savePerfStep('download.mediaLibrary.start');
      const libT0 = performance.now();
      await MediaLibrary.saveToLibraryAsync(uriToSave);
      savePerfStep('download.mediaLibrary.done', { ms: Math.round(performance.now() - libT0) });
      void firePostDownloadEngagement('save');
      alertSafe(t('save_success_title') || 'Saved', t('save_success_message') || 'Saved to gallery.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error ?? '');
      alertSafe(t('save_error_title') || 'Save failed', msg || t('save_error_message') || 'Something went wrong while saving.');
    } finally {
      savePerfEnd();
      if (isMountedRef.current) setIsDownloading(false);
    }
  };

  const handleShare = async () => {
      if (!isMountedRef.current || isNavigatingAwayRef.current || isSharing || isDownloading) return;
    let lastUri: string | null = null;
    let lastFilename: string | null = null;
    savePerfStart('share', {
      slides: originalData.length,
      frame: safeSelectedFrame,
      hasOverlay: !!overlayUrl,
    });
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
      savePerfStep('share.sheet.start');
      const shareT0 = performance.now();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(named.uri, { dialogTitle: named.filename, mimeType: 'image/jpeg' });
      } else {
        await Share.share({ message: t('share_message') });
      }
      savePerfStep('share.sheet.done', { ms: Math.round(performance.now() - shareT0) });
      void firePostDownloadEngagement('whatsapp_share');
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
      savePerfEnd();
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
    2: FRAME_STATIC_COLOR,
    3: '#2ECC71',
    4: '#1A73E8',
    5: '#E74C3C',
    6: '#8E44AD',
    7: '#2C3E50',
  };
  const visibleFrameIds = useMemo(() => [1, 2, ...frames.map((_, i) => i + 3)], [frames]);
  const visibleFrames = useMemo(
    () => [
      { id: 1, color: FRAME_STATIC_COLOR, url: null as string | null },
      { id: 2, color: FRAME_STATIC_COLOR, url: null as string | null },
      ...frames.map((f, i) => ({
        id: i + 3,
        color: FRAME_COLORS[i + 3] ?? '#333',
        url: resolveUserFrameOverlayUrl(f) || null,
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
                      { width: frameRenderWidth, aspectRatio: 4 / 5 },
                      useFrameChromeOverflow && { overflow: 'visible' as const },
                    ]}
                  >
                    <View style={styles.mediaDragWrapper}>
                      {item && typeof item === 'string' ? (
                        <CachedFrameMedia kind="daily" url={item} style={styles.fullMedia} contentFit="contain" />
                      ) : (
                        <View style={[styles.fullMedia, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
                          <ActivityIndicator size="small" color="#FFF" />
                        </View>
                      )}
                    </View>
                    <FrameEngine
                      frameId={safeSelectedFrame}
                      // Always mount: `activeIndex` can lag the visible page (pager / momentum / OEM
                      // scroll quirks), which made FrameEngine null on the slide the user actually sees.
                      mountComposer
                      staticChromeSide={staticChromeSide}
                      overlayPngUrl={overlayUrl}
                      displayName={displayName}
                      filledDesignations={filledDesignations}
                      profileLanguage={userInfo?.language}
                      partyName={userInfo?.partyName}
                      userForSocial={userInfo}
                      avatarUrl={avatarUrl}
                      frameCutoutUri={frameCutoutUri}
                      frameAvatarSlotMode={frameAvatarSlotMode}
                      onCutoutDisplayed={() => {
                        if (isMountedRef.current) setFrameAvatarSlotMode('cutout');
                      }}
                      onCutoutFailed={() => {
                        if (isMountedRef.current) {
                          setFrameCutoutUri(null);
                          setFrameAvatarSlotMode('original');
                        }
                      }}
                      isMounted={() => isMountedRef.current}
                      nameSize={NAME_SIZE}
                      designationSize={DESIGNATION_SIZE}
                      stripHeight={STRIP_HEIGHT}
                      contentSize={CONTENT_SIZE}
                    />
                  </View>
                </ViewShot>
              </View>
            ))}
          </ScrollView>
        </View>

        <FrameSelector
          items={visibleFrames}
          selectedFrame={selectedFrame}
          onSelectFrame={setSelectedFrame}
          sectionTitle={t('select_frame')}
          styles={{
            sectionTitle: styles.sectionTitle,
            framesGrid: styles.framesGrid,
            frameCard: styles.frameCard,
            miniFrameUI: styles.miniFrameUI,
            variantPreviewOuter: styles.variantPreviewOuter,
            variantPreviewTextBand: styles.variantPreviewTextBand,
            variantPreviewStrip: styles.variantPreviewStrip,
            variantPreviewAvatar: styles.variantPreviewAvatar,
            variantPreviewAvatarRight: styles.variantPreviewAvatarRight,
            variantPreviewAvatarLeft: styles.variantPreviewAvatarLeft,
          }}
        />

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
  sectionTitle: { fontSize: 16, fontWeight: '700', margin: 20 },
  variantPreviewOuter: { flex: 1, backgroundColor: '#F5F5F5' },
  variantPreviewTextBand: { position: 'absolute', left: 0, right: 0, bottom: 12, height: 16, backgroundColor: '#FCFCFC' },
  variantPreviewStrip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, backgroundColor: '#CBD5E1' },
  variantPreviewAvatar: { position: 'absolute', bottom: 0, width: 22, height: 22, borderRadius: 4, backgroundColor: '#94A3B8' },
  variantPreviewAvatarRight: { right: 0 },
  variantPreviewAvatarLeft: { left: 0 },
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
