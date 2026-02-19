import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Dimensions,
  Image,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useUser } from '../../context/UserContext';

const { width } = Dimensions.get('window');
const CANVAS_SIZE = Platform.OS === 'web' ? 500 : width - 40;

export default function PostDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { userInfo } = useUser(); // Real user data from context
  const [selectedFrame, setSelectedFrame] = useState(1);

  // Background image from navigation params
  const mainImage = params.image || 'https://picsum.photos/seed/default/800/800';

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(auth)/dashboard'); 
    }
  };

  const onShare = async () => {
    try {
      await Share.share({
        message: `Jai Hind! Check out my post for today.`,
        url: mainImage as string,
      });
    } catch (error) {
      console.log(error);
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
    <View style={styles.container}>
      {/* 1. Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Customize Post</Text>
        <View style={{ width: 40 }} /> 
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* 2. Main Post Preview */}
        <View style={[styles.previewContainer, { width: CANVAS_SIZE, height: CANVAS_SIZE }]}>
          <Image source={{ uri: mainImage as string }} style={styles.mainPostImage} />
          
          {/* Professional Overlay */}
          <View style={[styles.frameOverlay, { borderTopColor: frameStyles.find(f => f.id === selectedFrame)?.color }]}>
            
            {/* Left: Party Logo Area */}
            <View style={[styles.partyLogoCircle, { backgroundColor: frameStyles.find(f => f.id === selectedFrame)?.color }]}>
               <Ionicons name="flag" size={16} color="#FFF" />
            </View>

            {/* Center: Name and Designation */}
            <View style={styles.nameSection}>
                <Text style={styles.userName} numberOfLines={1}>
                    {userInfo?.name?.toUpperCase() || "MOHIT BHAI"}
                </Text>
                <Text style={styles.userDesignation} numberOfLines={1}>
                    {userInfo?.designation || "Social Media Warrior"}
                </Text>
            </View>

            {/* Right: User Photo */}
            <View style={styles.photoContainer}>
                <Image 
                    source={{ uri: userInfo?.profilePics?.[0] || "https://i.pravatar.cc/150?u=mohit" }} 
                    style={styles.userPhotoActual} 
                />
            </View>
          </View>
        </View>

        {/* 3. Frames Grid */}
        <Text style={styles.sectionTitle}>Select Frame Theme</Text>
        <View style={styles.framesGrid}>
          {frameStyles.map((f) => (
            <TouchableOpacity 
              key={f.id} 
              onPress={() => setSelectedFrame(f.id)}
              style={styles.frameCard}
            >
              <View style={[styles.miniFrameUI, selectedFrame === f.id && { borderColor: f.color, borderWidth: 3 }]}>
                 <View style={[styles.miniFooterUI, { backgroundColor: f.color + '20' }]}>
                    <View style={styles.miniLines} />
                    <View style={[styles.miniUserCircle, { backgroundColor: f.color }]} />
                 </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* 4. Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.shareBtn} onPress={onShare}>
            <Ionicons name="share-social-outline" size={22} color="#2ECC71" />
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.downloadBtn} onPress={() => alert('Feature coming soon!')}>
            <Ionicons name="download-outline" size={22} color="#FFF" />
            <Text style={styles.downloadBtnText}>Download</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { 
    paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 20, paddingBottom: 15,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0', backgroundColor: '#FFF'
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  
  scrollContent: { padding: 20, alignItems: 'center' },
  
  previewContainer: { 
    borderRadius: 20, backgroundColor: '#F0F0F0', overflow: 'hidden', position: 'relative',
    ...Platform.select({ 
        web: { boxShadow: '0px 10px 40px rgba(0,0,0,0.15)' }, 
        android: { elevation: 8 } 
    })
  },
  mainPostImage: { width: '100%', height: '100%', resizeMode: 'cover' },

  // OVERLAY LOGIC
  frameOverlay: { 
    position: 'absolute', bottom: 0, width: '100%', 
    height: 80, backgroundColor: 'rgba(255,255,255,0.98)', 
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, 
    borderTopWidth: 5 
  },

  partyLogoCircle: { 
    width: 32, height: 32, borderRadius: 16, 
    justifyContent: 'center', alignItems: 'center' 
  },

  nameSection: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  userName: { fontSize: 18, fontWeight: '900', color: '#000', textAlign: 'center' },
  userDesignation: { fontSize: 11, color: '#444', fontWeight: '600', marginTop: 2, textAlign: 'center' },

  photoContainer: { width: 60, alignItems: 'flex-end' },
  userPhotoActual: { 
    width: 65, height: 65, borderRadius: 8, 
    backgroundColor: '#DDD', marginTop: -40, 
    borderWidth: 3, borderColor: '#FFF' 
  },

  // GRID LOGIC
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 30, marginBottom: 15, alignSelf: 'flex-start' },
  framesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', width: '100%' },
  frameCard: { width: '33.33%', marginBottom: 15, alignItems: 'center', padding: 5 },
  miniFrameUI: { 
    width: '100%', aspectRatio: 1, borderRadius: 12, borderWidth: 1, borderColor: '#EEE', 
    backgroundColor: '#FFF', overflow: 'hidden', justifyContent: 'flex-end'
  },
  miniFooterUI: { height: '30%', width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, justifyContent: 'space-between' },
  miniUserCircle: { width: 12, height: 12, borderRadius: 2 },
  miniLines: { width: '60%', height: 4, backgroundColor: '#DDD', borderRadius: 2 },

  // BUTTONS
  buttonContainer: { marginTop: 20, width: '100%', gap: 12, paddingBottom: 40 },
  shareBtn: { height: 55, borderRadius: 15, borderWidth: 2, borderColor: '#2ECC71', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  shareBtnText: { color: '#2ECC71', fontSize: 16, fontWeight: '800' },
  downloadBtn: { height: 55, borderRadius: 15, backgroundColor: '#2ECC71', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  downloadBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' }
});