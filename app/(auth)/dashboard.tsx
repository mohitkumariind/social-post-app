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

const { width } = Dimensions.get('window');

// --- INTERFACES ---
interface Category {
  id: string;
  name: string;
  images: { url: string; shares: string }[];
}

// --- DATA ---
const BANNERS = [
  { id: 'b1', image: 'https://img.freepik.com/free-vector/gradient-social-media-marketing-concept_23-2149120613.jpg', title: 'Digital Campaigning Made Easy ⚡' },
  { id: 'b2', image: 'https://img.freepik.com/free-vector/political-election-banner-template_23-2148883330.jpg', title: 'Connect with Workers Instantly 🤝' },
  { id: 'b3', image: 'https://img.freepik.com/free-vector/gradient-world-social-justice-day-illustration_23-2149231267.jpg', title: 'Powerful Social Media Tools 🚀' },
];

const CATEGORY_DATA: Category[] = [
  { id: '1', name: "Today Post", images: [{ url: 'https://picsum.photos/seed/t1/800/1000', shares: '1.5k' }, { url: 'https://picsum.photos/seed/t2/800/1000', shares: '850' }, { url: 'https://picsum.photos/seed/t3/800/1000', shares: '1.2k' }, { url: 'https://picsum.photos/seed/t4/800/1000', shares: '3.4k' }] },
  { id: '2', name: "Motivational Post", images: [{ url: 'https://picsum.photos/seed/m1/800/1000', shares: '3.2k' }, { url: 'https://picsum.photos/seed/m2/800/1000', shares: '1.1k' }, { url: 'https://picsum.photos/seed/m3/800/1000', shares: '5k' }] },
  { id: '3', name: "Tomorrow Post", images: [{ url: 'https://picsum.photos/seed/tm1/800/1000', shares: '500' }, { url: 'https://picsum.photos/seed/tm2/800/1000', shares: '900' }] },
  { id: '4', name: "Party Post", images: [{ url: 'https://picsum.photos/seed/p1/800/1000', shares: '10k' }, { url: 'https://picsum.photos/seed/p2/800/1000', shares: '5.4k' }] },
  { id: '5', name: "Wishes", images: [{ url: 'https://picsum.photos/seed/w1/800/1000', shares: '7.2k' }, { url: 'https://picsum.photos/seed/w2/800/1000', shares: '4k' }] },
];

export default function DashboardScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [activeBanner, setActiveBanner] = useState(0);
  const bannerScrollRef = useRef<ScrollView>(null);
  const categoryCarouselRef = useRef<ScrollView>(null);

  // Auto-Slide Banners
  useEffect(() => {
    const timer = setInterval(() => {
      let nextIndex = activeBanner === BANNERS.length - 1 ? 0 : activeBanner + 1;
      setActiveBanner(nextIndex);
      bannerScrollRef.current?.scrollTo({ x: nextIndex * (width - 40), animated: true });
    }, 3500);
    return () => clearInterval(timer);
  }, [activeBanner]);

  const allTrending = useMemo(() => {
    return CATEGORY_DATA.map(cat => ({ ...cat.images[0], catSource: cat }));
  }, []);

  const openCategory = (cat: Category, index: number) => {
    setActiveCategory(cat);
    setTimeout(() => {
      categoryCarouselRef.current?.scrollTo({ x: index * width, animated: false });
    }, 50);
  };

  const handleGridScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    if (CATEGORY_DATA[index] && activeCategory?.id !== CATEGORY_DATA[index].id) {
      setActiveCategory(CATEGORY_DATA[index]);
    }
  };

  const renderHomeRows = () => (
    <View>
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>All (Trending)</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 20 }}>
          {allTrending.map((item, index) => (
            <TouchableOpacity key={index} style={styles.trendingItem} onPress={() => openCategory(item.catSource, index)}>
              <Image source={{ uri: item.url }} style={styles.postImage} />
              <View style={styles.catLabelBadge}><Text style={styles.catLabelText}>{item.catSource.name}</Text></View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {CATEGORY_DATA.map((cat, idx) => (
        <View key={cat.id} style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{cat.name}</Text>
            <TouchableOpacity onPress={() => openCategory(cat, idx)}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.postGridRow}>
            {cat.images.slice(0, 2).map((img, index) => (
              <TouchableOpacity key={index} style={styles.postItem} onPress={() => openCategory(cat, idx)}>
                <Image source={{ uri: img.url }} style={styles.postImage} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </View>
  );

  const renderSlidingGrids = () => (
    <View style={{ marginTop: 10 }}>
        <View style={styles.gridTitleBar}>
            <TouchableOpacity onPress={() => setActiveCategory(null)} style={styles.miniBackBtn}>
                <Ionicons name="arrow-back" size={18} color="#8A2BE2" />
                <Text style={styles.miniBackText}>Exit Swipe</Text>
            </TouchableOpacity>
            <Text style={styles.swipeHint}>Swipe for categories</Text>
        </View>

        <ScrollView 
            ref={categoryCarouselRef}
            horizontal 
            pagingEnabled 
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleGridScroll}
        >
            {CATEGORY_DATA.map((cat) => (
                <View key={cat.id} style={{ width: width }}>
                    <View style={styles.staggeredContainer}>
                        {cat.images.map((img, idx) => (
                            <TouchableOpacity 
                                key={idx} 
                                style={[styles.modernGridItem, { marginTop: idx % 2 === 0 ? 0 : 25 }]}
                                onPress={() => router.push({
                                    pathname: '/(auth)/post-detail',
                                    params: { image: img.url, images: JSON.stringify(cat.images.map(i => i.url)), currentIndex: idx }
                                })}
                            >
                                <Image source={{ uri: img.url }} style={styles.modernGridImg} />
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
      {/* --- YAHAN LINK FIX KI HAI --- */}
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => router.push('/(auth)/profile')} 
          style={styles.profileRow}
          activeOpacity={0.7}
        >
          <View style={styles.avatarPlaceholder}><Ionicons name="person" size={24} color="#8A2BE2" /></View>
          <View style={styles.welcomeTextGroup}>
            <Text style={styles.welcomeText}>Welcome!</Text>
            <Text style={styles.userName}>Hi, Mohit</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/(auth)/notifications')}>
          <Ionicons name="notifications-outline" size={28} color="#666" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
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

        <View style={styles.gradientHeaderWrapper}>
            <LinearGradient colors={['#8A2BE2', '#4B0082']} style={styles.eclipseGradient}>
                <Text style={styles.modernCenterTitle}>{activeCategory ? activeCategory.name : "Top Picks for You"}</Text>
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
  avatarPlaceholder: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#F0E6FF', justifyContent: 'center', alignItems: 'center' },
  welcomeTextGroup: { marginLeft: 12 },
  welcomeText: { fontSize: 11, color: '#999', fontWeight: '500' },
  userName: { fontSize: 18, fontWeight: '800', color: '#1A1A1A' },

  carouselContainer: { paddingHorizontal: 20, marginVertical: 10 },
  bannerCard: { width: width - 40, height: 160, borderRadius: 25, overflow: 'hidden' },
  bannerImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  bannerOverlay: { padding: 20, justifyContent: 'center', flex: 1, backgroundColor: 'rgba(0,0,0,0.2)' },
  bannerTitle: { fontSize: 19, fontWeight: '900', color: '#FFF', width: '70%' },

  gradientHeaderWrapper: { height: 60, marginVertical: 10, paddingHorizontal: 20 },
  eclipseGradient: { height: 50, width: '100%', borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  modernCenterTitle: { fontSize: 17, fontWeight: '800', color: '#FFF' },

  sectionContainer: { marginTop: 20 },
  sectionHeader: { paddingHorizontal: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  viewAllText: { color: '#8A2BE2', fontWeight: '700', fontSize: 13 },
  trendingItem: { width: 140, height: 180, borderRadius: 20, overflow: 'hidden', marginRight: 15, backgroundColor: '#F5F5F5' },
  postGridRow: { flexDirection: 'row', paddingHorizontal: 20, justifyContent: 'space-between' },
  postItem: { width: (width - 55) / 2, height: 180, borderRadius: 20, overflow: 'hidden', backgroundColor: '#F9F9F9' },
  postImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  catLabelBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(138, 43, 226, 0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  catLabelText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },

  gridTitleBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10, paddingHorizontal: 20 },
  miniBackBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0E6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  miniBackText: { color: '#8A2BE2', fontWeight: 'bold', fontSize: 12, marginLeft: 5 },
  swipeHint: { fontSize: 10, color: '#CCC' },
  
  staggeredContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 15, paddingBottom: 50 },
  modernGridItem: { width: (width - 50) / 2, height: 250, borderRadius: 24, overflow: 'hidden', backgroundColor: '#F9F9F9', elevation: 3 },
  modernGridImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  modernShareLabel: { position: 'absolute', bottom: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 3 },
  modernShareText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
});