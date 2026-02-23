import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import ViewShot from "react-native-view-shot";
import { useLang } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';

const { width, height } = Dimensions.get('window');

/** Frame 1 = static (code). Frames 2–6 = transparent PNG overlays per aspect. Replace with your API. */
const FRAME_OVERLAY_URLS_4_5: string[] = ['', '', '', '', '']; // 4:5 (1080x1350) – Frames 2–6
const FRAME_OVERLAY_URLS_9_16: string[] = ['', '', '', '', '']; // 9:16 (1080x1920) – Frames 2–6

const FRAME_STATIC_COLOR = '#FF9933'; // Frame 1 accent

export default function PostDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t } = useLang();
  const { userInfo } = useUser();
  const viewShotRef = useRef<any>(null); // Reference for capturing

  const isVideoParam = params.isVideo === 'true';
  const initialIndex = params.currentIndex ? parseInt(params.currentIndex as string) : 0;
  const aspectRatio = (params.aspectRatio as string) === '9:16' ? '9:16' : '4:5';

  const [selectedFrame, setSelectedFrame] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const originalData: string[] = useMemo(() => {
    try {
      if (params.images) {
        const parsed = JSON.parse(params.images as string);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { console.log("Data Parse Error", e); }
    return params.image ? [params.image as string] : [];
  }, [params.images, params.image]);

  const infiniteData = useMemo(() => {
    if (originalData.length <= 1) return originalData;
    return [...originalData, ...originalData, ...originalData];
  }, [originalData]);

  useEffect(() => {
    const total = originalData.length;
    const jumpTo = total > 1 ? total + initialIndex : 0;
    setActiveIndex(jumpTo);
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: jumpTo * width, animated: false });
      setIsReady(true);
    }, 400); 
    return () => clearTimeout(timer);
  }, [originalData, initialIndex]);

  // --- SAVE TO GALLERY LOGIC ---
  const handleDownload = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('permission_required'), t('permission_message'));
        return;
      }

      // Snapshot lena
      const uri = await viewShotRef.current.capture();
      
      // Gallery mein save karna
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(t('save_success_title'), t('save_success_message'));
    } catch (err) {
      console.log(err);
      Alert.alert(t('save_error_title'), t('save_error_message'));
    }
  };

  // --- DIRECT SHARE LOGIC ---
  const handleShare = async () => {
    try {
      const uri = await viewShotRef.current.capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Share.share({ message: t('share_message') });
      }
    } catch (err) {
      console.log(err);
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
    } else { setActiveIndex(index); }
  };

  const frameStyles = [
    { id: 1, color: FRAME_STATIC_COLOR },
    { id: 2, color: '#2ECC71' },
    { id: 3, color: '#1A73E8' },
    { id: 4, color: '#E74C3C' },
    { id: 5, color: '#8E44AD' },
    { id: 6, color: '#2C3E50' },
  ];

  const frameOverlayUrls = aspectRatio === '9:16' ? FRAME_OVERLAY_URLS_9_16 : FRAME_OVERLAY_URLS_4_5;
  const visibleFrameIds = useMemo(() => {
    const ids = [1, ...([2, 3, 4, 5, 6].filter((i) => frameOverlayUrls[i - 2]))];
    return ids;
  }, [aspectRatio, frameOverlayUrls]);
  const visibleFrames = useMemo(() => frameStyles.filter((f) => visibleFrameIds.includes(f.id)), [visibleFrameIds]);

  useEffect(() => {
    if (!visibleFrameIds.includes(selectedFrame)) setSelectedFrame(1);
  }, [visibleFrameIds, selectedFrame]);

  const isStaticFrame = selectedFrame === 1;
  const overlayUrl = selectedFrame >= 2 && selectedFrame <= 6 ? frameOverlayUrls[selectedFrame - 2] : null;

  const captionKeys = ['caption_1', 'caption_2', 'caption_3', 'caption_4', 'caption_5', 'caption_6'] as const;

  const handleCopyCaption = useCallback(
    async (key: typeof captionKeys[number]) => {
      const text = t(key);
      await Clipboard.setStringAsync(text);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setShowCopiedToast(true);
      toastTimerRef.current = setTimeout(() => {
        setShowCopiedToast(false);
        toastTimerRef.current = null;
      }, 2000);
    },
    [t]
  );

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('ready_to_post')} 🚀</Text>
        <View style={{ width: 40 }} /> 
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        <View style={{ opacity: isReady ? 1 : 0 }}>
          <ScrollView 
            ref={scrollRef} horizontal pagingEnabled 
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScrollEnd}
            scrollEventThrottle={16}
          >
            {infiniteData.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.slideWrapper}>
                
                {/* --- VIEWSHOT WRAPS THE POSTER --- */}
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
                    {isVideoParam ? (
                      <Video
                        style={styles.fullMedia}
                        source={{ uri: item }}
                        resizeMode={ResizeMode.CONTAIN}
                        isLooping
                        shouldPlay={isReady && index === activeIndex}
                        useNativeControls={false}
                        usePoster={true}
                        posterSource={{ uri: item }}
                      />
                    ) : (
                      <Image source={{ uri: item }} style={styles.fullMedia} resizeMode="contain" />
                    )}
                    
                    {/* FRAME OVERLAY: Frame 1 = static View, Frames 2–6 = PNG from backend */}
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
                          <Image 
                            source={{ uri: userInfo?.profilePics?.[userInfo?.activePhotoIndex || 0] || "https://i.pravatar.cc/150" }} 
                            style={styles.userPhotoActual} 
                          />
                        </View>
                      </View>
                    )}
                    {overlayUrl ? (
                      <Image
                        source={{ uri: overlayUrl }}
                        style={styles.frameOverlayImage}
                        resizeMode="contain"
                      />
                    ) : null}
                  </View>
                </ViewShot>

              </View>
            ))}
          </ScrollView>
        </View>

        {/* THEMES GRID */}
        <Text style={styles.sectionTitle}>{t('select_frame')}</Text>
        <View style={styles.framesGrid}>
          {visibleFrames.map((f) => (
            <TouchableOpacity key={f.id} onPress={() => setSelectedFrame(f.id)} style={styles.frameCard}>
              <View style={[styles.miniFrameUI, selectedFrame === f.id && { borderColor: f.color, borderWidth: 3 }]} />
            </TouchableOpacity>
          ))}
        </View>

        {/* COPY CAPTION */}
        <Text style={styles.sectionTitle}>{t('copy_caption')}</Text>
        <View style={styles.captionList}>
          {captionKeys.map((key) => (
            <TouchableOpacity
              key={key}
              style={styles.captionCard}
              onPress={() => handleCopyCaption(key)}
              activeOpacity={0.8}
            >
              <Text style={styles.captionCardText} numberOfLines={2}>{t(key)}</Text>
              <View style={styles.captionCopyBtn}>
                <Ionicons name="copy-outline" size={20} color="#8A2BE2" />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* BUTTONS CONNECTED TO REAL FUNCTIONS */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
            <Ionicons name="logo-whatsapp" size={22} color="#2ECC71" />
            <Text style={styles.shareBtnText}>{t('share_whatsapp')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.downloadBtn} onPress={handleDownload}>
            <Ionicons name="download-outline" size={22} color="#FFF" />
            <Text style={styles.downloadBtnText}>{t('save_to_gallery')}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 50 }} />
      </ScrollView>

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
  scrollContent: { paddingVertical: 10 },
  slideWrapper: { width: width, alignItems: 'center', justifyContent: 'center' },
  mediaContainer: { width: width - 20, backgroundColor: '#000', borderRadius: 24, overflow: 'hidden', position: 'relative' },
  fullMedia: { width: '100%', height: '100%' },
  frameOverlayImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  frameOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'rgba(255,255,255,0.98)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderTopWidth: 5 },
  partyLogoCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  nameSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  userName: { fontSize: 18, fontWeight: '900', color: '#000' },
  userDesignation: { fontSize: 11, color: '#666', fontWeight: '600' },
  photoContainer: { width: 60, alignItems: 'flex-end' },
  userPhotoActual: { width: 65, height: 65, borderRadius: 8, marginTop: -40, borderWidth: 3, borderColor: '#FFF' },
  sectionTitle: { fontSize: 16, fontWeight: '700', margin: 20 },
  framesGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15 },
  frameCard: { width: '33.33%', height: 60, padding: 5 },
  miniFrameUI: { flex: 1, borderRadius: 8, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#DDD' },
  buttonContainer: { padding: 25, gap: 12 },
  shareBtn: { height: 55, borderRadius: 15, borderWidth: 2, borderColor: '#2ECC71', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  shareBtnText: { color: '#2ECC71', fontSize: 16, fontWeight: '800' },
  downloadBtn: { height: 55, borderRadius: 15, backgroundColor: '#2ECC71', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  downloadBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  captionList: { paddingHorizontal: 15, paddingBottom: 8 },
  captionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#DDD',
  },
  captionCardText: { flex: 1, fontSize: 14, color: '#333', fontWeight: '500', lineHeight: 20, marginRight: 12 },
  captionCopyBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E8E0FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toast: {
    position: 'absolute',
    bottom: 100,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4B0082',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
});