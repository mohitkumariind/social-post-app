import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
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
import { useUser } from '../../context/UserContext'; // Context Import Kiya

const { width } = Dimensions.get('window');

// --- INTERFACES ---
interface Category {
  id: string;
  name: string;
  images: { url: string; shares: string; isVideo?: boolean }[];
}

// --- DATA ---
const BANNERS = [
  { id: 'b1', image: 'https://img.freepik.com/free-vector/gradient-social-media-marketing-concept_23-2149120613.jpg', title: 'Digital Campaigning Made Easy ⚡' },
  { id: 'b2', image: 'https://img.freepik.com/free-vector/political-election-banner-template_23-2148883330.jpg', title: 'Connect with Workers Instantly 🤝' },
  { id: 'b3', image: 'https://img.freepik.com/free-vector/gradient-world-social-justice-day-illustration_23-2149231267.jpg', title: 'Powerful Social Media Tools 🚀' },
];

const GRAPHICS_DATA: Category[] = [
  { id: 'g1', name: "Today Post", images: [{ url: 'https://picsum.photos/seed/t1/1080/1080', shares: '1.5k' }, { url: 'https://picsum.photos/seed/t2/1080/1350', shares: '850' }, { url: 'https://picsum.photos/seed/t3/1080/1080', shares: '2k' }] },
  { id: 'g2', name: "Motivational", images: [{ url: 'https://picsum.photos/seed/m1/1080/1350', shares: '3.2k' }, { url: 'https://picsum.photos/seed/m2/1080/1080', shares: '1.1k' }] },
  { id: 'g3', name: "Party Post", images: [{ url: 'https://picsum.photos/seed/p1/1080/1080', shares: '10k' }, { url: 'https://picsum.photos/seed/p2/1200/675', shares: '5.4k' }] },
];

const REELS_DATA: Category[] = [
  { id: 'r1', name: "Trending Reels", images: [{ url: 'https://picsum.photos/seed/r1/1080/1920', shares: '50k', isVideo: true }, { url: 'https://picsum.photos/seed/r2/1080/1920', shares: '12k', isVideo: true }] },
  { id: 'r2', name: "Political Reels", images: [{ url: 'https://picsum.photos/seed/r3/1080/1920', shares: '100k', isVideo: true }, { url: 'https://picsum.photos/seed/r4/1080/1920', shares: '5k', isVideo: true }] },
  { id: 'r3', name: "Wishes Reels", images: [{ url: 'https://picsum.photos/seed/r5/1080/1920', shares: '30k', isVideo: true }, { url: 'https://picsum.photos/seed/r6/1080/1920', shares: '8k', isVideo: true }] },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { userInfo } = useUser(); // User Context se data nikaala
  const [activeTab, setActiveTab] = useState('graphics'); 
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [activeBanner, setActiveBanner] = useState(0);
  
  const bannerScrollRef = useRef<ScrollView>(null);
  const categoryCarouselRef = useRef<ScrollView>(null);
  const trendingRef = useRef<ScrollView>(null);

  const CURRENT_DATA = activeTab === 'graphics' ? GRAPHICS_DATA : REELS_DATA;

  // Auto-Slide Banners
  useEffect(() => {
    if (BANNERS.length === 0) return;
    const timer = setInterval(() => {
      let nextIndex = activeBanner === BANNERS.length - 1 ? 0 : activeBanner + 1;
      setActiveBanner(nextIndex);
      bannerScrollRef.current?.scrollTo({ x: nextIndex * (width - 40), animated: true });
    }, 3500);
    return () => clearInterval(timer);
  }, [activeBanner]);

  useEffect(() => {
    const itemWidth = 140 + 15;
    const initialOffset = itemWidth * CURRENT_DATA.length;
    trendingRef.current?.scrollTo({ x: initialOffset, animated: false });
  }, [activeTab]);

  const allTrending = useMemo(() => {
    return CURRENT_DATA.map(cat => ({ ...cat.images[0], catSource: cat }));
  }, [CURRENT_DATA]);

  const infiniteTrendingData = useMemo(() => {
    return [...allTrending, ...allTrending, ...allTrending]; 
  }, [allTrending]);

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
        <Ionicons name="image" size={18} color={activeTab === 'graphics' ? '#FFF' : '#8A2BE2'} />
        <Text style={[styles.tabText, activeTab === 'graphics' && styles.activeTabText]}>Graphics</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.tabButton, activeTab === 'reels' && styles.activeTab]} onPress={() => handleTabChange('reels')}>
        <Ionicons name="play-circle" size={18} color={activeTab === 'reels' ? '#FFF' : '#8A2BE2'} />
        <Text style={[styles.tabText, activeTab === 'reels' && styles.activeTabText]}>Reels</Text>
      </TouchableOpacity>
    </View>
  );

  const renderTrendingSection = () => (
    <View style={styles.sectionContainer}>
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{activeTab === 'graphics' ? 'Trending Graphics' : 'Trending Reels'}</Text>
            {activeCategory && (
                <TouchableOpacity onPress={() => setActiveCategory(null)} style={styles.backLink}>
                    <Text style={styles.backLinkText}>Explore All 🚀</Text>
                </TouchableOpacity>
            )}
        </View>
        <ScrollView 
          ref={trendingRef} horizontal showsHorizontalScrollIndicator={false} 
          onScroll={handleTrendingScroll} scrollEventThrottle={16}
          contentContainerStyle={{ paddingLeft: 20 }}
        >
          {infiniteTrendingData.map((item, index) => (
            <TouchableOpacity key={index} style={styles.trendingItem} onPress={() => switchCategory(item.catSource, index % allTrending.length)}>
              <Image source={{ uri: item.url }} style={styles.postImage} />
              {item.isVideo && <View style={styles.playIconOverlay}><Ionicons name="play" size={24} color="#FFF" /></View>}
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
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.postGridRow}>
            {cat.images.slice(0, 2).map((img, index) => (
              <TouchableOpacity 
                key={index} style={styles.postItem} 
                onPress={() => router.push({ pathname: '/post-detail', params: { isVideo: img.isVideo ? 'true' : 'false', image: img.url, images: JSON.stringify(cat.images.map(i => i.url)), currentIndex: index } })}
              >
                <Image source={{ uri: img.url }} style={styles.postImage} />
                {img.isVideo && <View style={styles.playIconOverlay}><Ionicons name="play" size={24} color="#FFF" /></View>}
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
                    <LinearGradient colors={['#8A2BE2', '#4B0082']} style={styles.allTrendingGradient}>
                        <Ionicons name={activeTab === 'graphics' ? "apps" : "videocam"} size={50} color="#FFF" />
                        <Text style={styles.allTrendingTitle}>{activeTab === 'graphics' ? "All Graphics" : "All Reels"}</Text>
                        <Text style={styles.allTrendingSub}>Tap to see categories</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>

            {CURRENT_DATA.map((cat) => (
                <View key={cat.id} style={{ width: width }}>
                    <View style={styles.gridSectionHeader}>
                        <Text style={styles.gridSectionTitle}>{cat.name}</Text>
                        <Text style={styles.gridSectionSub}>Swipe left to go back</Text>
                    </View>
                    <View style={styles.staggeredContainer}>
                        {cat.images.map((img, idx) => (
                            <TouchableOpacity 
                                key={idx} style={[styles.modernGridItem, { marginTop: idx % 2 === 0 ? 0 : 25 }]}
                                onPress={() => router.push({ 
                                    pathname: '/post-detail', 
                                    params: { isVideo: img.isVideo ? 'true' : 'false', image: img.url, images: JSON.stringify(cat.images.map(i => i.url)), currentIndex: idx } 
                                })}
                            >
                                <Image source={{ uri: img.url }} style={styles.modernGridImg} />
                                {img.isVideo && <View style={styles.playIconOverlay}><Ionicons name="play" size={32} color="#FFF" /></View>}
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
    <SafeAreaView style={styles.container}>
      {/* --- UPDATED HEADER WITH CONTEXT --- */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/profile')} style={styles.profileRow}>
          <View style={styles.avatarPlaceholder}>
            {userInfo?.profilePics?.[0] ? (
              <Image source={{ uri: userInfo.profilePics[0] }} style={{ width: 45, height: 45, borderRadius: 22.5 }} />
            ) : (
              <Ionicons name="person" size={24} color="#8A2BE2" />
            )}
          </View>
          <View style={styles.welcomeTextGroup}>
            <Text style={styles.welcomeText}>Welcome!</Text>
            <Text style={styles.userName}>Hi, {userInfo?.name?.split(' ')[0] || 'User'}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={28} color="#666" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
        <View style={styles.carouselContainer}>
          <ScrollView ref={bannerScrollRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {BANNERS.map((banner) => (
              <View key={banner.id} style={styles.bannerCard}>
                <Image source={{ uri: banner.image }} style={styles.bannerImg} />
                <View style={styles.bannerOverlay}><Text style={styles.bannerTitle}>{banner.title}</Text></View>
              </View>
            ))}
          </ScrollView>
        </View>

        {renderTabs()}

        <View style={styles.gradientHeaderWrapper}>
            <LinearGradient colors={['#8A2BE2', '#4B0082']} style={styles.eclipseGradient}>
                <Text style={styles.modernCenterTitle}>
                  {activeCategory ? activeCategory.name : (activeTab === 'graphics' ? "Top Picks Graphics" : "Top Picks Reels")}
                </Text>
            </LinearGradient>
        </View>

        {activeCategory ? renderSlidingGrids() : renderHomeRows()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingTop: Platform.OS === 'android' ? 40 : 10, paddingHorizontal: 25, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  avatarPlaceholder: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#F0E6FF', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  welcomeTextGroup: { marginLeft: 12 },
  welcomeText: { fontSize: 11, color: '#999', fontWeight: '500' },
  userName: { fontSize: 18, fontWeight: '800', color: '#1A1A1A' },
  carouselContainer: { paddingHorizontal: 20, marginVertical: 10 },
  bannerCard: { width: width - 40, height: 160, borderRadius: 25, overflow: 'hidden' },
  bannerImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  bannerOverlay: { padding: 20, justifyContent: 'center', flex: 1, backgroundColor: 'rgba(0,0,0,0.1)' },
  bannerTitle: { fontSize: 19, fontWeight: '900', color: '#FFF', width: '70%' },
  tabContainer: { flexDirection: 'row', marginHorizontal: 25, marginVertical: 10, backgroundColor: '#F5F0FF', borderRadius: 15, padding: 5, borderWidth: 1, borderColor: '#E6D5FF' },
  tabButton: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 12, borderRadius: 12, gap: 8 },
  activeTab: { backgroundColor: '#8A2BE2' },
  tabText: { fontWeight: '700', color: '#8A2BE2', fontSize: 14 },
  activeTabText: { color: '#FFF' },
  gradientHeaderWrapper: { height: 60, marginVertical: 10, paddingHorizontal: 20 },
  eclipseGradient: { height: 50, width: '100%', borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  modernCenterTitle: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  sectionContainer: { marginTop: 25 },
  sectionHeader: { paddingHorizontal: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: '#1A1A1A' },
  viewAllText: { color: '#8A2BE2', fontWeight: '700', fontSize: 13 },
  backLink: { backgroundColor: '#F0E6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  backLinkText: { color: '#8A2BE2', fontSize: 12, fontWeight: '800' },
  trendingItem: { width: 140, height: 140, borderRadius: 20, overflow: 'hidden', marginRight: 15, backgroundColor: '#F9F9F9', borderWidth: 1, borderColor: '#F0F0F0' },
  postGridRow: { flexDirection: 'row', paddingHorizontal: 20, justifyContent: 'space-between' },
  postItem: { width: (width - 55) / 2, height: 180, borderRadius: 20, overflow: 'hidden', backgroundColor: '#F9F9F9', borderWidth: 1, borderColor: '#F0F0F0' },
  postImage: { width: '100%', height: '100%', resizeMode: 'contain', backgroundColor: '#F5F5F5' },
  playIconOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.15)' },
  catLabelBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(138, 43, 226, 0.9)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, elevation: 3 },
  catLabelText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  gridSectionHeader: { paddingHorizontal: 25, marginBottom: 15, marginTop: 10 },
  gridSectionTitle: { fontSize: 22, fontWeight: '900', color: '#1A1A1A' },
  gridSectionSub: { fontSize: 12, color: '#999', marginTop: 2 },
  allTrendingBackCard: { width: width - 80, height: 350, borderRadius: 30, overflow: 'hidden', elevation: 10, shadowColor: '#8A2BE2', shadowOpacity: 0.5, shadowRadius: 10 },
  allTrendingGradient: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 15 },
  allTrendingTitle: { color: '#FFF', fontSize: 28, fontWeight: '900' },
  allTrendingSub: { color: '#E0E0E0', fontSize: 14 },
  staggeredContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 15, paddingBottom: 50 },
  modernGridItem: { width: (width - 50) / 2, height: 220, borderRadius: 24, overflow: 'hidden', backgroundColor: '#F9F9F9', elevation: 4 },
  modernGridImg: { width: '100%', height: '100%', resizeMode: 'contain' },
  modernShareLabel: { position: 'absolute', bottom: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  modernShareText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
});