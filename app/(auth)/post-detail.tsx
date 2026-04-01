import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { downloadMediaToCache } from '../../lib/mediaCache';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ViewShot from "react-native-view-shot";
import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { supabase } from '../../lib/supabase';

const { width } = Dimensions.get('window');

const FRAME_STATIC_COLOR = Colors.primary;

const IMAGE_PLACEHOLDER_BLURHASH =
  // Neutral shimmer-like placeholder (works on both light/dark)
  'LGFFaXYk^6#M@-5c,1J5@[or[Q6.';

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
  return (
    <View style={style}>
      {loading ? <View style={[StyleSheet.absoluteFillObject, { backgroundColor: Colors.borderLight }]} /> : null}
      <ExpoImage
        source={{ uri: String(uri || url) }}
        style={StyleSheet.absoluteFillObject}
        contentFit={contentFit ?? 'contain'}
        cachePolicy="disk"
        placeholder={{ blurhash: IMAGE_PLACEHOLDER_BLURHASH }}
        transition={200}
      />
    </View>
  );
}

/** Validates URL - must be non-empty string, http/https. */
function isValidVideoUrl(url: unknown): boolean {
  if (url == null || typeof url !== 'string') return false;
  const s = url.trim();
  if (s.length === 0) return false;
  try {
    const normalized = s.startsWith('http://') ? s.replace('http://', 'https://') : s;
    const u = new URL(normalized);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Placeholder when video URL invalid. */
function VideoPlaceholder({ uri }: { uri: string }) {
  return (
    <View style={[styles.fullMedia, { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' }]}>
      <Ionicons name="videocam-outline" size={64} color="#666" />
      <Text style={{ color: '#FFF', marginTop: 12, fontSize: 14 }}>Video placeholder</Text>
    </View>
  );
}

/** Safe Mode video player: autoPlay false, preload none, native controls. Only mounts when URL validated. */
function ReelVideoSlide({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, () => {
    // autoPlay: false - do not call player.play()
    // preload: 'none' - expo-video loads on mount; user taps play via native controls
  });
  return (
    <View style={styles.fullMedia}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="contain"
        nativeControls={true}
      />
    </View>
  );
}

/** Renders video only when URL is validated; else placeholder. */
function VideoSlideOrPlaceholder({ uri, isActive }: { uri: string; isActive: boolean }) {
  if (!isValidVideoUrl(uri)) {
    return <VideoPlaceholder uri={uri} />;
  }

  // On-demand caching: start download only when user lands on this slide
  const { uri: cachedUri, loading } = useCachedMediaUri({
    kind: 'daily',
    url: isActive ? uri : null,
    ext: 'mp4',
  });

  if (isActive && loading) {
    return (
      <View style={[styles.fullMedia, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ marginTop: 10, color: Colors.textMuted, fontWeight: '700' }}>Caching video…</Text>
      </View>
    );
  }

  // Use cached local uri if available; fallback to remote
  return <ReelVideoSlide uri={String(cachedUri || uri)} />;
}

/** Normalizes video URL to https. */
function normalizeVideoUrl(url: string): string {
  const s = url.trim();
  return s.startsWith('http://') ? s.replace('http://', 'https://') : s;
}

export default function PostDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t } = useLang();
  const { userInfo } = useUser();
  const viewShotRef = useRef<any>(null);

  const isVideoParam = params?.isVideo === 'true';
  const initialIndex = params?.currentIndex != null ? parseInt(String(params.currentIndex), 10) : 0;
  const aspectRatio = (params?.aspectRatio as string) === '9:16' ? '9:16' : '4:5';

  const [frames, setFrames] = useState<any[]>([]);
  const [selectedFrame, setSelectedFrame] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dynamicCaptions, setDynamicCaptions] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backNavLockRef = useRef(false);

  const goBackToExpandedCategory = useCallback(() => {
    if (backNavLockRef.current) return true;
    backNavLockRef.current = true;
    const categoryRaw = params?.category;
    const category =
      typeof categoryRaw === 'string'
        ? categoryRaw
        : Array.isArray(categoryRaw)
          ? categoryRaw[0]
          : undefined;
    const tabRaw = params?.fromTab;
    const tabParam =
      typeof tabRaw === 'string'
        ? tabRaw
        : Array.isArray(tabRaw)
          ? tabRaw[0]
          : (isVideoParam ? 'reels' : 'graphics');

    if (category && category.trim().length > 0) {
      router.replace({
        pathname: '/(tabs)/dashboard',
        params: { expandCategory: category, expandTab: tabParam },
      });
    } else {
      router.back();
    }
    return true;
  }, [isVideoParam, params?.category, params?.fromTab, router]);

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
    } catch (e) {
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
          setIsReady(true);
        } catch (e) {
          setIsReady(true);
        }
      }, 400);
      return () => clearTimeout(timer);
    } catch (e) {
      setIsReady(true);
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

        const { data, error } = await supabase.from('user_frames').select('*').eq('user_id', uid);
        if (cancelled) return;
        if (error) {
          if (!cancelled && __DEV__) console.warn('[PostDetail] fetchFrames error:', error.message);
          return;
        }
        if (data) setFrames(data);
      } catch (e) {
        if (!cancelled && __DEV__) console.warn('fetchFrames exception');
      }
    };
    fetchFrames();
    return () => { cancelled = true; };
  }, []);

  const isStaticFrame = selectedFrame === 1;
  const overlayUrl =
    selectedFrame >= 2 && selectedFrame - 2 < frames.length
      ? (frames[selectedFrame - 2]?.url || frames[selectedFrame - 2]?.frame_url || null)
      : null;

  const processVideoMerge = useCallback(async (): Promise<string | null> => {
    const total = originalData.length;
    if (total === 0) return null;
    const realIndex = total > 1 ? activeIndex % total : 0;
    const videoUrl = originalData[realIndex];
    if (!videoUrl || !isValidVideoUrl(videoUrl)) return null;

    const normalizedUrl = normalizeVideoUrl(videoUrl);
    if (!FileSystem.documentDirectory) return null;

    const toPath = (u: string) => (u || '').replace(/^file:\/\//, '');

    // Use global cache utility: daily for videos, frame for overlays.
    const cachedVideoUri = await downloadMediaToCache({ kind: 'daily', url: normalizedUrl, ext: 'mp4' });
    if (!cachedVideoUri || !String(cachedVideoUri).startsWith('file://')) return null;

    const cachedOverlayUri =
      overlayUrl && overlayUrl.trim().length > 0
        ? await downloadMediaToCache({ kind: 'frame', url: overlayUrl, ext: 'png' })
        : null;

    // Stable output file path (no Date.now) so repeated burns reuse output.
    const outDir = `${(FileSystem.cacheDirectory || FileSystem.documentDirectory || '').replace(/\/?$/, '/') }video-exports/`;
    try {
      await FileSystem.makeDirectoryAsync(outDir, { intermediates: true });
    } catch {}

    const outKey = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `out:${normalizedUrl}:${String(cachedOverlayUri || '')}`
    );
    const outputPath = `${outDir}burn_${outKey}.mp4`;

    try {
      const outInfo = await FileSystem.getInfoAsync(outputPath);
      if (outInfo.exists) return outputPath.startsWith('file://') ? outputPath : `file://${outputPath}`;

      const inputLocal = toPath(String(cachedVideoUri));
      const outputLocal = toPath(outputPath);

      if (cachedOverlayUri && String(cachedOverlayUri).startsWith('file://')) {
        const overlayLocal = toPath(String(cachedOverlayUri));
        const session = await FFmpegKit.execute(
          `-i "${inputLocal}" -i "${overlayLocal}" -filter_complex "[0:v]scale=1080:1920,setsar=1[v0];[1:v]scale=1080:1920,setsar=1[v1];[v0][v1]overlay=0:0[outv]" -map "[outv]" -map 0:a? -c:a copy -b:v 4M "${outputLocal}"`
        );
        const returnCode = await session.getReturnCode();
        if (!ReturnCode.isSuccess(returnCode)) return null;
      } else {
        const session = await FFmpegKit.execute(
          `-i "${inputLocal}" -filter_complex "[0:v]scale=1080:1920,setsar=1[outv]" -map "[outv]" -map 0:a? -c:a copy -b:v 4M "${outputLocal}"`
        );
        const returnCode = await session.getReturnCode();
        if (!ReturnCode.isSuccess(returnCode)) return null;
      }

      const doneInfo = await FileSystem.getInfoAsync(outputPath);
      if (!doneInfo.exists) return null;
      return outputPath.startsWith('file://') ? outputPath : `file://${outputPath}`;
    } catch (err) {
      if (__DEV__) console.warn('processVideoMerge error');
      return null;
    }
  }, [originalData, activeIndex, overlayUrl]);

  const handleDownload = async () => {
    if (isVideoParam) {
      try {
        setProcessing(true);
        const { status } = await MediaLibrary.requestPermissionsAsync(
          true,
          Platform.OS === 'android' ? ['photo', 'video'] : undefined
        );
        if (status !== 'granted') {
          Alert.alert(t('permission_required'), t('permission_message'));
          return;
        }
        const videoUri = await processVideoMerge();
        if (!videoUri) {
          Alert.alert(t('save_error_title'), t('save_error_message'));
          return;
        }
        const uriToSave = videoUri.startsWith('file://') ? videoUri : `file://${videoUri}`;
        try {
          await MediaLibrary.createAssetAsync(uriToSave);
        } catch (createErr) {
          try {
            await MediaLibrary.saveToLibraryAsync(uriToSave);
          } catch (saveErr) {
            if (__DEV__) console.warn('createAssetAsync / saveToLibraryAsync failed');
            throw createErr;
          }
        }
        Alert.alert(t('save_success_title'), t('save_success_message'));
      } catch (err) {
        if (__DEV__) console.warn('Video save error');
        Alert.alert(t('save_error_title'), t('save_error_message'));
      } finally {
        setProcessing(false);
      }
      return;
    }
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('permission_required'), t('permission_message'));
        return;
      }
      const shotRef = viewShotRef.current;
      if (!shotRef) {
        Alert.alert(t('save_error_title'), t('save_error_message'));
        return;
      }
      const uri = await shotRef.capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(t('save_success_title'), t('save_success_message'));
    } catch (err) {
      if (__DEV__) console.warn('save poster failed');
      Alert.alert(t('save_error_title'), t('save_error_message'));
    }
  };

  const handleShare = async () => {
    if (isVideoParam) {
      try {
        setProcessing(true);
        const videoUri = await processVideoMerge();
        if (!videoUri) {
          Alert.alert(t('save_error_title'), t('save_error_message'));
          return;
        }
        const shareUri = videoUri.startsWith('file://') ? videoUri : `file://${videoUri}`;
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(shareUri);
        } else {
          Share.share({ message: t('share_message') });
        }
      } catch (err) {
        if (__DEV__) console.warn('share video failed');
        Alert.alert(t('save_error_title'), t('save_error_message'));
      } finally {
        setProcessing(false);
      }
      return;
    }
    try {
      const shotRef = viewShotRef.current;
      if (!shotRef) return;
      const uri = await shotRef.capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Share.share({ message: t('share_message') });
      }
    } catch (err) {
      if (__DEV__) console.warn('share failed');
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
    console.log('LOGGING CAPTIONS:', value);
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

  const handleCopyCaption = useCallback(
    async (text: string) => {
      if (!text?.trim()) return;
      await Clipboard.setStringAsync(text);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setShowCopiedToast(true);
      toastTimerRef.current = setTimeout(() => {
        setShowCopiedToast(false);
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
            scrollEventThrottle={16}
          >
            {infiniteData.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.slideWrapper}>
                <ViewShot
                  ref={index === activeIndex ? viewShotRef : null}
                  options={{
                    format: 'jpg',
                    quality: 1.0,
                    width: 1080,
                    height: aspectRatio === '9:16' ? 1920 : 1350,
                  }}
                >
                  <View style={[styles.mediaContainer, { aspectRatio: aspectRatio === '9:16' ? 9 / 16 : 4 / 5 }]}>
                    <View style={styles.mediaDragWrapper}>
                      {isVideoParam ? (
                        <VideoSlideOrPlaceholder uri={item} isActive={index === activeIndex} />
                      ) : (
                        item && typeof item === 'string' ? (
                          <CachedMediaImage kind="daily" url={item} style={styles.fullMedia} contentFit="contain" />
                        ) : (
                          <View style={[styles.fullMedia, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
                            <ActivityIndicator size="small" color="#FFF" />
                          </View>
                        )
                      )}
                    </View>
                    {isStaticFrame && (
                      <View style={[styles.frameOverlay, { borderTopColor: FRAME_STATIC_COLOR }]}>
                        <View style={[styles.partyLogoCircle, { backgroundColor: FRAME_STATIC_COLOR }]}>
                          <Ionicons name="flag" size={16} color="#FFF" />
                        </View>
                        <View style={styles.nameSection}>
                          <Text style={styles.userName} numberOfLines={1}>
                            {userInfo?.name?.toUpperCase() || t('default_user_name').toUpperCase()}
                          </Text>
                          <Text style={styles.userDesignation} numberOfLines={1}>
                            {userInfo?.designation || t('default_designation')}
                          </Text>
                        </View>
                        <View style={styles.photoContainer}>
                          {userInfo?.avatar_url?.trim() ? (
                            <View style={styles.userPhotoActual}>
                              <ExpoImage
                                source={{ uri: userInfo.avatar_url }}
                                style={StyleSheet.absoluteFillObject}
                                contentFit="cover"
                                cachePolicy="disk"
                                placeholder={{ blurhash: IMAGE_PLACEHOLDER_BLURHASH }}
                                transition={200}
                              />
                            </View>
                          ) : (
                            <View style={[styles.userPhotoActual, styles.userPhotoPlaceholder]}>
                              <Ionicons name="person" size={28} color="#FFF" />
                            </View>
                          )}
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
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={processing}>
            <Ionicons name="logo-whatsapp" size={22} color={Colors.textOnPrimary} />
            <Text style={styles.shareBtnText}>{processing ? '...' : t('share_whatsapp')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.downloadBtn, processing && { opacity: 0.7 }]} onPress={handleDownload} disabled={processing}>
            {processing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="download-outline" size={22} color="#FFF" />
            )}
            <Text style={styles.downloadBtnText}>{processing ? '...' : t('save_to_gallery')}</Text>
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
  slideWrapper: { width: width, alignItems: 'center', justifyContent: 'center' },
  mediaContainer: { width: width - 20, backgroundColor: '#000', borderRadius: 0, overflow: 'hidden', position: 'relative' },
  mediaDragWrapper: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  fullMedia: { width: '100%', height: '100%' },
  frameOverlayImageWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  frameOverlayImage: { width: '100%', aspectRatio: 4 / 5 },
  frameOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'rgba(255,255,255,0.98)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderTopWidth: 5 },
  partyLogoCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  nameSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  userName: { fontSize: 18, fontWeight: '900', color: '#1A1A1A' },
  userDesignation: { fontSize: 11, color: '#666', fontWeight: '600' },
  photoContainer: { width: 60, alignItems: 'flex-end' },
  userPhotoActual: { width: 65, height: 65, borderRadius: 8, marginTop: -40, borderWidth: 3, borderColor: '#FFF' },
  userPhotoPlaceholder: { backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', alignItems: 'center' },
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
