import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useUser } from '../../context/UserContext';

const { width, height } = Dimensions.get('window');

export default function PostDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { userInfo } = useUser();
  
  const isVideoParam = params.isVideo === 'true';
  const initialIndex = params.currentIndex ? parseInt(params.currentIndex as string) : 0;
  
  const [selectedFrame, setSelectedFrame] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // 1. DATA PARSING (Checked: Full Category Data)
  const originalData: string[] = useMemo(() => {
    try {
      if (params.images) {
        const parsed = JSON.parse(params.images as string);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { console.log("JSON Parse Error", e); }
    return params.image ? [params.image as string] : ['https://picsum.photos/seed/pol/800/800'];
  }, [params.images, params.image]);

  // 2. INFINITE BUFFER (Checked: Triple Set for loop)
  const infiniteData = useMemo(() => {
    if (originalData.length <= 1) return originalData;
    return [...originalData, ...originalData, ...originalData];
  }, [originalData]);

  // 3. INITIAL JUMP & FLICKER FIX (Checked: Perfect Landing)
  useEffect(() => {
    const total = originalData.length;
    // Jump to middle set
    const jumpTo = total > 1 ? total + initialIndex : 0;
    setActiveIndex(jumpTo);

    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: jumpTo * width, animated: false });
      setIsReady(true);
    }, 200); 

    return () => clearTimeout(timer);
  }, [originalData, initialIndex]);

  // 4. INFINITE LOOP HANDLER (Checked: Seamless Jump)
  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
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

  const frameStyles = [
    { id: 1, color: '#FF9933' },
    { id: 2, color: '#2ECC71' },
    { id: 3, color: '#1A73E8' },
    { id: 4, color: '#E74C3C' },
    { id: 5, color: '#8E44AD' },
    { id: 6, color: '#2C3E50' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ready to Post 🚀</Text>
        <View style={{ width: 40 }} /> 
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* MEDIA AREA */}
        <View style={{ opacity: isReady ? 1 : 0 }}>
          <ScrollView 
            ref={scrollRef}
            horizontal 
            pagingEnabled 
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScrollEnd}
            scrollEventThrottle={16}
            decelerationRate="fast"
          >
            {infiniteData.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.slideWrapper}>
                <View style={styles.mediaContainer}>
                  {isVideoParam ? (
                    <Video
                      style={styles.fullMedia}
                      source={{ uri: item }}
                      resizeMode={ResizeMode.CONTAIN}
                      isLooping
                      shouldPlay={isReady && index === activeIndex}
                      useNativeControls={false}
                    />
                  ) : (
                    <Image source={{ uri: item }} style={styles.fullMedia} resizeMode="contain" />
                  )}
                  
                  {/* Fixed Lower Frame */}
                  <View style={[styles.frameOverlay, { borderTopColor: frameStyles.find(f => f.id === selectedFrame)?.color }]}>
                    <View style={[styles.partyLogoCircle, { backgroundColor: frameStyles.find(f => f.id === selectedFrame)?.color }]}>
                      <Ionicons name="flag" size={16} color="#FFF" />
                    </View>
                    <View style={styles.nameSection}>
                      <Text style={styles.userName} numberOfLines={1}>{userInfo?.name?.toUpperCase() || "MOHIT KUMAR"}</Text>
                      <Text style={styles.userDesignation} numberOfLines={1}>{userInfo?.designation || "Social Media Warrior"}</Text>
                    </View>
                    <View style={styles.photoContainer}>
                      <Image source={{ uri: userInfo?.profilePics?.[0] || "https://i.pravatar.cc/150" }} style={styles.userPhotoActual} />
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* THEMES GRID */}
        <Text style={styles.sectionTitle}>Select Frame Theme</Text>
        <View style={styles.framesGrid}>
          {frameStyles.map((f) => (
            <TouchableOpacity key={f.id} onPress={() => setSelectedFrame(f.id)} style={styles.frameCard}>
              <View style={[styles.miniFrameUI, selectedFrame === f.id && { borderColor: f.color, borderWidth: 3 }]}>
                 <View style={[styles.miniFooterUI, { backgroundColor: f.color + '20' }]}>
                    <View style={styles.miniLines} />
                    <View style={[styles.miniUserCircle, { backgroundColor: f.color }]} />
                 </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* BUTTONS */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.shareBtn} onPress={() => Share.share({ message: 'Jai Hind!' })}>
            <Ionicons name="share-social-outline" size={22} color="#2ECC71" />
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.downloadBtn} onPress={() => Alert.alert('Jai Hind', 'HD Poster Saved!')}>
            <Ionicons name="download-outline" size={22} color="#FFF" />
            <Text style={styles.downloadBtnText}>Download</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingTop: Platform.OS === 'ios' ? 10 : 40, paddingHorizontal: 20, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingVertical: 10 },
  slideWrapper: { width: width, alignItems: 'center', justifyContent: 'center' },
  mediaContainer: { 
    width: width - 20, 
    height: height * 0.72, // Reel ke liye kafi space
    backgroundColor: '#000', 
    borderRadius: 24, 
    overflow: 'hidden', 
    position: 'relative',
    justifyContent: 'center',
    elevation: 10 
  },
  fullMedia: { width: '100%', height: '100%' },
  frameOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'rgba(255,255,255,0.98)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderTopWidth: 5, zIndex: 999 },
  partyLogoCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  nameSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  userName: { fontSize: 18, fontWeight: '900', color: '#000', textAlign: 'center' },
  userDesignation: { fontSize: 11, color: '#444', fontWeight: '600', marginTop: 2, textAlign: 'center' },
  photoContainer: { width: 60, alignItems: 'flex-end' },
  userPhotoActual: { width: 65, height: 65, borderRadius: 8, backgroundColor: '#DDD', marginTop: -40, borderWidth: 3, borderColor: '#FFF' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 15, paddingHorizontal: 25 },
  framesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', width: '100%', paddingHorizontal: 15 },
  frameCard: { width: '33.33%', marginBottom: 15, alignItems: 'center', padding: 5 },
  miniFrameUI: { width: '100%', aspectRatio: 1, borderRadius: 12, borderWidth: 1, borderColor: '#EEE', backgroundColor: '#FFF', overflow: 'hidden', justifyContent: 'flex-end' },
  miniFooterUI: { height: '30%', width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, justifyContent: 'space-between' },
  miniUserCircle: { width: 12, height: 12, borderRadius: 2 },
  miniLines: { width: '60%', height: 4, backgroundColor: '#DDD', borderRadius: 2 },
  buttonContainer: { marginTop: 10, width: '100%', gap: 12, paddingBottom: 40, paddingHorizontal: 25 },
  shareBtn: { height: 55, borderRadius: 15, borderWidth: 2, borderColor: '#2ECC71', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  shareBtnText: { color: '#2ECC71', fontSize: 16, fontWeight: '800' },
  downloadBtn: { height: 55, borderRadius: 15, backgroundColor: '#2ECC71', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  downloadBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' }
});