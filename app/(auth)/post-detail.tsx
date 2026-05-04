import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
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
import { supabase, supabaseAnonKey, supabaseUrl } from '../../lib/supabase';

const FRAME_STATIC_COLOR = Colors.primary;

/** Minimum height for the off-white name / designation band. */
const FRAME_TEXT_BAND_MIN_HEIGHT = 55;

type PartySocialStripPalette = { bg: string; fg: string };

/** Party-colored bottom strip + contrasting label/icon color. */
function getFramePartyStripPalette(partyName: unknown): PartySocialStripPalette {
  const p = String(partyName ?? '').toLowerCase();
  if (p.includes('bjp')) return { bg: '#FF9933', fg: '#1E293B' };
  if (p.includes('congress')) return { bg: '#00A03E', fg: '#FFFFFF' };
  if (p.includes('aap') || p.includes('aam aadmi')) return { bg: '#003399', fg: '#FFFFFF' };
  if (p.includes('akali')) return { bg: '#FFCC00', fg: '#1E293B' };
  return { bg: '#1E293B', fg: '#FFFFFF' };
}

type FrameSocialStripItem = { key: string; icon: string; value: string };

function buildFrameSocialStripItems(u: { whatsapp?: string; facebook?: string; twitter?: string; instagram?: string } | null | undefined): FrameSocialStripItem[] {
  if (!u) return [];
  const out: FrameSocialStripItem[] = [];
  const wa = String(u.whatsapp ?? '').trim();
  if (wa) out.push({ key: 'wa', icon: 'logo-whatsapp', value: wa });
  const fb = String(u.facebook ?? '').trim();
  if (fb) out.push({ key: 'fb', icon: 'logo-facebook', value: fb });
  const tw = String(u.twitter ?? '').trim();
  if (tw) out.push({ key: 'tw', icon: 'logo-twitter', value: tw });
  const ig = String(u.instagram ?? '').trim();
  if (ig) out.push({ key: 'ig', icon: 'logo-instagram', value: ig });
  return out;
}

const getFontForLang = (lang: string | undefined, isName: boolean) => {
  const language = lang || 'en';
  switch (language) {
    case 'hi':
    case 'en':
      return { fontFamily: isName ? 'Poppins-ExtraBold' : 'Poppins-Bold', fontWeight: (isName ? '800' : '700') as const };
    case 'pa':
      return {
        fontFamily: isName ? 'NotoSansGurmukhi-ExtraBold' : 'NotoSansGurmukhi-Bold',
        fontWeight: (isName ? '800' : '700') as const,
      };
    case 'gu':
      return {
        fontFamily: isName ? 'NotoSansGujarati-ExtraBold' : 'NotoSansGujarati-Bold',
        fontWeight: (isName ? '800' : '700') as const,
      };
    case 'mr':
      return { fontFamily: isName ? 'GoogleSans-Bold' : 'GoogleSans-SemiBold', fontWeight: '700' as const };
    default:
      return { fontFamily: isName ? 'Poppins-ExtraBold' : 'Poppins-Bold', fontWeight: (isName ? '800' : '700') as const };
  }
};

/** Supabase Storage — same bucket as post graphics / avatars */
const POST_IMAGES_BUCKET = 'post-images';
/** PixelBin Predictions API — `erase_bg` → path segment `erase/bg` (see @pixelbin/admin Predictions.js). */
const PIXELBIN_API_ORIGIN = 'https://api.pixelbin.io';
const PIXELBIN_PREDICTIONS_ERASE_BG = `${PIXELBIN_API_ORIGIN}/service/platform/transformation/v1.0/predictions/erase/bg`;
/** PixelBin API token (client-side: easy to extract; prefer a backend proxy for production). */
const PIXELBIN_TOKEN = 'ec264319-6e12-41b2-8079-e85a763f2026';

const CUTOUT_LOG = '[PostDetail][Cutout]';

function getTransparentCutoutObjectPath(userId: string): string {
  return `transparent-avatars/${userId}.png`;
}

async function postImagesObjectExists(objectPath: string): Promise<boolean> {
  console.log(CUTOUT_LOG, 'Checking Supabase cache for object:', objectPath);
  const folder = objectPath.includes('/') ? objectPath.slice(0, objectPath.lastIndexOf('/')) : '';
  const fileName = objectPath.includes('/') ? objectPath.slice(objectPath.lastIndexOf('/') + 1) : objectPath;
  const searchPrefix = fileName.replace(/\.png$/i, '') || fileName;
  const { data, error } = await supabase.storage.from(POST_IMAGES_BUCKET).list(folder, {
    limit: 100,
    search: searchPrefix,
  });
  if (error) {
    console.log(CUTOUT_LOG, 'Cache list error (treating as miss):', error.message);
    return false;
  }
  const hit = (data ?? []).some((f) => f.name === fileName);
  console.log(CUTOUT_LOG, hit ? 'Cached cutout file FOUND' : 'Cached cutout file NOT found', {
    folder,
    fileName,
    listed: (data ?? []).length,
  });
  return hit;
}

async function uploadCutoutPngViaRest(localUri: string, objectPath: string, accessToken: string): Promise<void> {
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${POST_IMAGES_BUCKET}/${objectPath}`;
  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'x-upsert': 'true',
      'Content-Type': 'image/png',
      Accept: 'application/json',
    },
  });
  if (result.status < 200 || result.status >= 300) {
    const body = typeof result.body === 'string' ? result.body : '';
    throw new Error(`Cutout storage upload failed (${result.status})${body ? `: ${body.slice(0, 400)}` : ''}`);
  }
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

function uint8ToBase64(u8: Uint8Array): string {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('btoa is not available for cutout temp file encoding');
  }
  let binary = '';
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]!);
  }
  return globalThis.btoa(binary);
}

/**
 * Writes cutout PNG locally, uploads to Supabase; on any upload failure returns local `file://` URI
 * so the frame can show the removed background immediately.
 */
async function persistCutoutAfterPixelBin(
  userId: string,
  pngBlob: Blob
): Promise<{ kind: 'remote'; publicUrl: string } | { kind: 'local'; localUri: string }> {
  const objectPath = getTransparentCutoutObjectPath(userId);
  const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? null;
  if (!cacheDir) throw new Error('No cache directory for cutout upload');

  const localPngUri = `${cacheDir}transparent-cutout-${userId}-${Date.now()}.png`;
  const ab = await blobToArrayBuffer(pngBlob);
  const u8 = new Uint8Array(ab);
  await FileSystem.writeAsStringAsync(localPngUri, uint8ToBase64(u8), {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log(CUTOUT_LOG, 'Wrote PixelBin PNG to temp file', localPngUri, 'bytes', u8.byteLength);

  try {
    console.log(CUTOUT_LOG, 'Supabase upload starting (js client)', objectPath);
    const { error } = await supabase.storage.from(POST_IMAGES_BUCKET).upload(objectPath, u8, {
      upsert: true,
      contentType: 'image/png',
    });
    if (error) {
      console.log(CUTOUT_LOG, 'Supabase storage.upload error:', error.message, error);
      throw error;
    }
    console.log(CUTOUT_LOG, 'Supabase storage.upload OK', objectPath);
  } catch (e1) {
    console.log(CUTOUT_LOG, 'Supabase js upload failed; trying REST PUT fallback', e1);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        console.log(CUTOUT_LOG, 'No session access_token; cannot REST upload — using local cutout URI');
        return { kind: 'local', localUri: localPngUri };
      }
      await uploadCutoutPngViaRest(localPngUri, objectPath, accessToken);
      console.log(CUTOUT_LOG, 'Supabase REST upload OK', objectPath);
    } catch (e2) {
      console.log(CUTOUT_LOG, 'Supabase upload failed completely — using local cutout URI on frame', e2);
      return { kind: 'local', localUri: localPngUri };
    }
  }

  try {
    await FileSystem.deleteAsync(localPngUri, { idempotent: true });
    console.log(CUTOUT_LOG, 'Removed temp cutout file after successful upload');
  } catch {
    /* ignore */
  }

  const { data } = supabase.storage.from(POST_IMAGES_BUCKET).getPublicUrl(objectPath);
  console.log(CUTOUT_LOG, 'Remote cutout public URL ready');
  return { kind: 'remote', publicUrl: data.publicUrl };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PixelBin erase_bg via official Predictions API (multipart + poll + download output).
 * Auth matches Pixelbin JS SDK: Authorization: Bearer base64(apiSecret) for ASCII secrets.
 */
async function fetchTransparentCutoutFromPixelBin(sourceImageUri: string, sourceNameForMime: string): Promise<Blob> {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('btoa is not available for PixelBin auth');
  }
  const encodedToken = globalThis.btoa(String(PIXELBIN_TOKEN).trim());
  const authHeaders = { Authorization: `Bearer ${encodedToken}` };

  console.log(CUTOUT_LOG, 'PixelBin Predictions create starting', PIXELBIN_PREDICTIONS_ERASE_BG, {
    tokenLen: PIXELBIN_TOKEN.length,
    b64AuthLen: encodedToken.length,
  });

  const ext = sourceNameForMime.split('.').pop()?.toLowerCase() ?? '';
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/jpeg';

  const form = new FormData();
  form.append('input.image', { uri: sourceImageUri, name: `source.${ext || 'jpg'}`, type: mime } as any);
  form.append('input.industry_type', 'human');
  form.append('input.quality_type', 'original');
  form.append('input.refine', 'true');
  form.append('input.shadow', 'false');

  const controller = new AbortController();
  const timeoutMs = 240000;
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(PIXELBIN_PREDICTIONS_ERASE_BG, {
      method: 'POST',
      headers: authHeaders,
      body: form,
      signal: controller.signal,
    });

    console.log(CUTOUT_LOG, 'PixelBin create HTTP', {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
    });

    const createText = await res.text().catch(() => '');
    if (!res.ok) {
      console.log(CUTOUT_LOG, 'PixelBin create error body (truncated):', createText.slice(0, 500));
      throw new Error(`PixelBin create failed (${res.status}): ${createText.slice(0, 300)}`);
    }

    let createJson: { _id?: string; id?: string; status?: string };
    try {
      createJson = JSON.parse(createText) as { _id?: string; id?: string; status?: string };
    } catch {
      console.log(CUTOUT_LOG, 'PixelBin create non-JSON body (truncated):', createText.slice(0, 300));
      throw new Error('PixelBin create: expected JSON job response');
    }

    const jobId = createJson._id ?? createJson.id;
    console.log(CUTOUT_LOG, 'PixelBin job created', { jobId: jobId ?? null, initialStatus: createJson.status ?? null });
    if (!jobId || typeof jobId !== 'string') {
      throw new Error(`PixelBin create: missing job id: ${createText.slice(0, 400)}`);
    }

    const statusPath = `/service/platform/transformation/v1.0/predictions/${encodeURIComponent(jobId)}`;
    const statusUrl = `${PIXELBIN_API_ORIGIN}${statusPath}`;

    for (let attempt = 1; attempt <= 90; attempt++) {
      await sleepMs(2000);
      const stRes = await fetch(statusUrl, { headers: authHeaders, signal: controller.signal });
      const stText = await stRes.text().catch(() => '');
      let detail: {
        status?: string;
        output?: string[];
        message?: string;
        error?: unknown;
      } = {};
      try {
        detail = JSON.parse(stText) as typeof detail;
      } catch {
        console.log(CUTOUT_LOG, 'PixelBin poll non-JSON (truncated):', stText.slice(0, 200));
      }

      console.log(CUTOUT_LOG, `PixelBin poll ${attempt}/90`, {
        httpOk: stRes.ok,
        jobStatus: detail.status ?? null,
      });

      if (!stRes.ok) {
        throw new Error(`PixelBin poll failed (${stRes.status}): ${stText.slice(0, 250)}`);
      }

      if (detail.status === 'SUCCESS') {
        const outUrl = Array.isArray(detail.output) ? detail.output[0] : undefined;
        if (!outUrl || typeof outUrl !== 'string') {
          throw new Error(`PixelBin SUCCESS but no output URL: ${stText.slice(0, 400)}`);
        }
        console.log(CUTOUT_LOG, 'PixelBin fetching result PNG', outUrl.slice(0, 80) + '…');
        const imgRes = await fetch(outUrl, { signal: controller.signal });
        if (!imgRes.ok) {
          const t = await imgRes.text().catch(() => '');
          throw new Error(`PixelBin output fetch failed (${imgRes.status}): ${t.slice(0, 200)}`);
        }
        const blob = await imgRes.blob();
        console.log(CUTOUT_LOG, 'PixelBin OK; PNG blob', { size: blob?.size, type: blob?.type });
        return blob;
      }

      if (detail.status === 'FAILURE') {
        console.log(CUTOUT_LOG, 'PixelBin job FAILURE body (truncated):', stText.slice(0, 500));
        throw new Error(`PixelBin prediction failed: ${detail.message ?? stText.slice(0, 300)}`);
      }
    }

    throw new Error('PixelBin prediction timed out (still pending after 90 polls)');
  } catch (err) {
    console.log(CUTOUT_LOG, 'PixelBin pipeline threw:', err);
    throw err;
  } finally {
    clearTimeout(to);
  }
}

/** Solid skeleton while graphics / frame URLs resolve (no blurhash placeholder). */
const IMAGE_SKELETON_BG = '#E8E8E8';

type FrameAvatarSlotMode = 'loading' | 'cutout' | 'original';

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

  // Rendered "frame" size on-screen (same aspect ratio as ViewShot: 1080x1350 => 4/5).
  const frameRenderWidth = width - 20;
  const frameRenderHeight = (frameRenderWidth * 5) / 4;

  // Dynamic micro-strip sizing derived from rendered frame height.
  const STRIP_HEIGHT = frameRenderHeight * 0.03; // 3% of frame height
  const CONTENT_SIZE = frameRenderHeight * 0.0182; // 30% smaller than 0.026

  // Dynamic text sizing derived from rendered frame height.
  const NAME_SIZE = frameRenderHeight * 0.052; // requested
  const DESIGNATION_SIZE = frameRenderHeight * 0.035;

  const initialIndex = params?.currentIndex != null ? parseInt(String(params.currentIndex), 10) : 0;

  const [frames, setFrames] = useState<any[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<number>(1);
  const selectedFrameNum = Number(selectedFrame);
  const safeSelectedFrame = Number.isFinite(selectedFrameNum) && selectedFrameNum > 0 ? selectedFrameNum : 1;

  // Frame variant is derived from the first two static "frame slots":
  // 1 => Variant A (avatar right)
  // 2 => Variant B (avatar left)
  const isAvatarRight = safeSelectedFrame !== 2;
  const AVATAR_SLOT = 135;
  const TEXT_SAFE_MARGIN = 125;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [dynamicCaptions, setDynamicCaptions] = useState<string[]>([]);
  /** Cached PixelBin cutout public URL; null until resolved or unavailable. */
  const [frameCutoutUri, setFrameCutoutUri] = useState<string | null>(null);
  /** Avoid showing original avatar while cutout pipeline runs or cutout image is decoding. */
  const [frameAvatarSlotMode, setFrameAvatarSlotMode] = useState<FrameAvatarSlotMode>('loading');
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

  const isStaticFrame = safeSelectedFrame === 1 || safeSelectedFrame === 2;
  // Render user's input as-is (supports regional/local languages).
  const displayName = String(userInfo?.name ?? '');
  const avatarUrl = String(userInfo?.avatar_url ?? '').trim();

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

  const partySocialStripPalette = useMemo(
    () => getFramePartyStripPalette(userInfo?.partyName),
    [userInfo?.partyName]
  );

  const socialStripItems = useMemo(() => buildFrameSocialStripItems(userInfo), [
    userInfo?.whatsapp,
    userInfo?.facebook,
    userInfo?.twitter,
    userInfo?.instagram,
  ]);

  const socialStripJustifyContent = useMemo(() => {
    const count = socialStripItems.length;
    if (count <= 2) return 'center' as const;
    return isAvatarRight ? ('flex-start' as const) : ('flex-end' as const);
  }, [isAvatarRight, socialStripItems.length]);

  useEffect(() => {
    console.log('[PostDetail] selectedFrame=', safeSelectedFrame, 'isAvatarRight=', isAvatarRight);
  }, [isAvatarRight, safeSelectedFrame]);

  useEffect(() => {
    let cancelled = false;
    setFrameCutoutUri(null);
    setFrameAvatarSlotMode('loading');

    (async () => {
      try {
        console.log(CUTOUT_LOG, 'Pipeline start (avatarUrl changed)');

        const src = String(avatarUrl ?? '').trim();
        if (!src) {
          console.log(CUTOUT_LOG, 'Skip: no avatarUrl');
          return;
        }

        // Match fetchFrames: auth restore can lag navigation; a single getSession miss
        // must not lock us into `original` forever (effect only re-runs when avatarUrl changes).
        let uid: string | undefined;
        for (let i = 0; i < 5; i++) {
          const { data: sess } = await supabase.auth.getSession();
          uid = sess?.session?.user?.id;
          if (uid) break;
          const { data: authUser } = await supabase.auth.getUser();
          uid = authUser?.user?.id;
          if (uid) break;
          await new Promise((r) => setTimeout(r, 400));
          if (cancelled) return;
        }

        if (!uid) {
          console.log(CUTOUT_LOG, 'Skip: missing uid after retries; fallback to original avatar on frame');
          if (!cancelled && isMountedRef.current) setFrameAvatarSlotMode('original');
          return;
        }

        const objectPath = getTransparentCutoutObjectPath(uid);
        const cached = await postImagesObjectExists(objectPath);
        if (cancelled || !isMountedRef.current) return;

        if (cached) {
          const { data } = supabase.storage.from(POST_IMAGES_BUCKET).getPublicUrl(objectPath);
          console.log(CUTOUT_LOG, 'Using cached remote cutout URL');
          if (!cancelled && isMountedRef.current) setFrameCutoutUri(data.publicUrl);
          return;
        }

        console.log(CUTOUT_LOG, 'PixelBin path: downloading source avatar for erase_bg');

        const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? null;
        if (!cacheDir) throw new Error('No cache directory');

        const cleanUrl = src.split('?')[0] ?? src;
        const ext = cleanUrl.includes('.') ? (cleanUrl.split('.').pop()?.toLowerCase() ?? 'jpg') : 'jpg';
        const safeExt = ext.length <= 5 && /^[a-z0-9]+$/i.test(ext) ? ext : 'jpg';
        const tmpSrc = `${cacheDir}pixelbin-src-${uid}-${Date.now()}.${safeExt}`;

        await FileSystem.downloadAsync(src, tmpSrc);
        if (cancelled || !isMountedRef.current) return;

        console.log(CUTOUT_LOG, 'Triggering PixelBin erase_bg API');
        const pngBlob = await fetchTransparentCutoutFromPixelBin(tmpSrc, `source.${safeExt}`);
        try {
          await FileSystem.deleteAsync(tmpSrc, { idempotent: true });
        } catch {
          /* ignore */
        }
        if (cancelled || !isMountedRef.current) return;

        const persisted = await persistCutoutAfterPixelBin(uid, pngBlob);
        if (cancelled || !isMountedRef.current) return;

        if (persisted.kind === 'remote') {
          console.log(CUTOUT_LOG, 'Frame will use remote cutout URL');
          setFrameCutoutUri(persisted.publicUrl);
        } else {
          console.log(CUTOUT_LOG, 'Frame will use LOCAL temp cutout (upload failed):', persisted.localUri);
          setFrameCutoutUri(persisted.localUri);
        }
      } catch (e) {
        console.log(CUTOUT_LOG, 'Pipeline failed; frame falls back to normal avatar_url', e);
        if (!cancelled && isMountedRef.current) {
          setFrameCutoutUri(null);
          setFrameAvatarSlotMode('original');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  const overlayUrl =
    safeSelectedFrame >= 3 && safeSelectedFrame - 3 < frames.length
      ? (frames[safeSelectedFrame - 3]?.url || frames[safeSelectedFrame - 3]?.frame_url || null)
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
            await FileSystem.copyAsync({ from: rawUri, to: dest });
            uriToSave = dest;
          } catch {
            await FileSystem.moveAsync({ from: rawUri, to: dest });
            uriToSave = dest;
          }
        } catch (copyErr) {
          if (__DEV__) console.warn('[PostDetail] gallery named file copy failed, saving capture URI', copyErr);
        }
      }

      await MediaLibrary.saveToLibraryAsync(uriToSave);
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
                      { width: frameRenderWidth, aspectRatio: 4 / 5 },
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
                        <View
                          style={[
                            styles.frameTextBand,
                            { minHeight: FRAME_TEXT_BAND_MIN_HEIGHT },
                            !avatarUrl && styles.frameTextBandFullBleed,
                          ]}
                        >
                          <View
                            style={[
                              styles.frameTextBandInner,
                              avatarUrl
                                ? (isAvatarRight ? { marginRight: TEXT_SAFE_MARGIN } : { marginLeft: TEXT_SAFE_MARGIN })
                                : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.userName,
                                getFontForLang(userInfo?.language, true),
                                { fontSize: NAME_SIZE, lineHeight: Math.round(NAME_SIZE * 1.2) },
                              ]}
                            >
                              {displayName}
                            </Text>
                            {filledDesignations.map((line, idx) => (
                              <Text
                                key={`d-${idx}-${line.slice(0, 32)}`}
                                style={[
                                  styles.userDesignation,
                                  getFontForLang(userInfo?.language, false),
                                  idx > 0 ? styles.userDesignationStacked : null,
                                  { fontSize: DESIGNATION_SIZE, lineHeight: Math.round(DESIGNATION_SIZE * 1.2) },
                                ]}
                              >
                                {line}
                              </Text>
                            ))}
                          </View>
                        </View>

                        <View
                          style={[
                            styles.framePartySocialStrip,
                            { height: STRIP_HEIGHT, backgroundColor: partySocialStripPalette.bg },
                          ]}
                        >
                          <View style={[styles.framePartySocialRow, { justifyContent: socialStripJustifyContent }]}>
                            {socialStripItems.map((it) => (
                              <View key={it.key} style={styles.framePartySocialItem}>
                                <Ionicons name={it.icon as any} size={CONTENT_SIZE} color={partySocialStripPalette.fg} />
                                <Text
                                  style={[
                                    styles.framePartySocialText,
                                    { color: partySocialStripPalette.fg, fontSize: CONTENT_SIZE },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {it.value}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>

                        <View
                          style={[
                            styles.avatarDock,
                            isAvatarRight ? styles.avatarDockRight : styles.avatarDockLeft,
                            { bottom: STRIP_HEIGHT },
                          ]}
                        >
                          {avatarUrl ? (
                            <View style={styles.userPhotoActual}>
                              {frameAvatarSlotMode === 'original' ? (
                                <ExpoImage
                                  source={{ uri: avatarUrl }}
                                  style={[StyleSheet.absoluteFillObject, styles.frameAvatarImage]}
                                  contentFit="cover"
                                  cachePolicy="disk"
                                  recyclingKey={avatarUrl}
                                />
                              ) : frameCutoutUri ? (
                                <ExpoImage
                                  key={frameCutoutUri}
                                  source={{ uri: frameCutoutUri }}
                                  style={[
                                    StyleSheet.absoluteFillObject,
                                    styles.frameAvatarImage,
                                    frameAvatarSlotMode === 'loading' ? { opacity: 0 } : null,
                                  ]}
                                  contentFit="contain"
                                  cachePolicy="disk"
                                  recyclingKey={frameCutoutUri}
                                  onLoad={() => {
                                    if (isMountedRef.current) setFrameAvatarSlotMode('cutout');
                                  }}
                                  onLoadEnd={() => {
                                    if (isMountedRef.current) setFrameAvatarSlotMode('cutout');
                                  }}
                                  onError={() => {
                                    if (isMountedRef.current) {
                                      setFrameCutoutUri(null);
                                      setFrameAvatarSlotMode('original');
                                    }
                                  }}
                                />
                              ) : null}
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
            <TouchableOpacity key={f.id} onPress={() => setSelectedFrame(Number(f.id))} style={styles.frameCard}>
              {f.id === 1 || f.id === 2 ? (
                <View style={[styles.miniFrameUI, selectedFrame === f.id && { borderColor: Colors.accent, borderWidth: 3 }]}>
                  <View style={styles.variantPreviewOuter}>
                    <View style={styles.variantPreviewTextBand} />
                    <View style={[styles.variantPreviewAvatar, f.id === 1 ? styles.variantPreviewAvatarRight : styles.variantPreviewAvatarLeft]} />
                    <View style={styles.variantPreviewStrip} />
                  </View>
                </View>
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
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    overflow: 'visible',
    padding: 0,
    margin: 0,
  },
  /** Off-white name + designations; height grows with lines (minHeight from constant in JSX). */
  frameTextBand: {
    backgroundColor: '#FCFCFC',
    paddingTop: 2,
    paddingBottom: 2,
    paddingHorizontal: 10,
    zIndex: 0,
    justifyContent: 'flex-end',
  },
  frameTextBandFullBleed: {
    paddingHorizontal: 10,
  },
  frameTextBandInner: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  frameTextBandInnerWithAvatarRight: { marginRight: 0 },
  frameTextBandInnerWithAvatarLeft: { marginLeft: 0 },
  framePartySocialStrip: {
    width: '100%',
    zIndex: 3,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  framePartySocialRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  framePartySocialItem: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  framePartySocialText: {
    marginLeft: 3,
    fontFamily: 'Poppins-Bold',
    fontWeight: '700',
    flexShrink: 1,
  },
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
  frameAvatarImage: {
    backgroundColor: 'transparent',
  },
  avatarDock: {
    position: 'absolute',
    zIndex: 4,
    width: 135,
    height: 135,
    margin: 0,
    padding: 0,
    justifyContent: 'flex-end',
  },
  // Explicitly clear the opposite side when switching variants (prevents stale absolute offsets).
  avatarDockRight: { right: 0, left: null as any, alignItems: 'flex-end' },
  avatarDockLeft: { left: 0, right: null as any, alignItems: 'flex-start' },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 0,
    paddingBottom: 0,
    lineHeight: 18,
  },
  userDesignation: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
    textAlign: 'center',
    marginVertical: 0,
    paddingVertical: 0,
    lineHeight: 14,
  },
  userDesignationStacked: { marginTop: 0 },
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
