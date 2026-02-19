import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef } from 'react';
import {
  Dimensions,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import ViewShot from 'react-native-view-shot';
import { useUser } from '../context/UserContext';

const { width } = Dimensions.get('window');
const CANVAS_SIZE = Platform.OS === 'web' ? 500 : width - 40;

export default function EditorScreen() {
  const router = useRouter();
  const { userInfo } = useUser();
  const viewShotRef = useRef(null);

  const currentPhoto = userInfo?.profilePics?.[userInfo.activePhotoIndex] || "https://via.placeholder.com/400";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Neta Ji Poster Editor</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* POSTER SECTION */}
        <View style={{ width: CANVAS_SIZE, height: CANVAS_SIZE, elevation: 20 }}>
          <ViewShot ref={viewShotRef} options={{ format: "jpg", quality: 0.9 }}>
            <View style={[styles.posterCanvas, { width: CANVAS_SIZE, height: CANVAS_SIZE }]}>
              
              {/* 1. BACKGROUND */}
              <LinearGradient colors={['#D4FC79', '#96E6A1']} style={StyleSheet.absoluteFill} />

              {/* 2. PHOTO (STRICTLY RIGHT ALIGN) */}
              <View style={styles.imageWrapper}>
                <Image source={{ uri: currentPhoto }} style={styles.userPhoto} />
              </View>

              {/* 3. TEXT OVERLAY (CENTERED) */}
              <View style={styles.textOverlay}>
                <LinearGradient 
                  colors={['transparent', 'rgba(0,0,0,0.85)']} 
                  style={StyleSheet.absoluteFill} 
                />
                <View style={styles.textCenterBox}>
                  <Text style={styles.userName}>{userInfo?.name?.toUpperCase() || "NETA JI"}</Text>
                  <Text style={styles.userDesig}>{userInfo?.designation || "Social Media Warrior"}</Text>
                </View>
              </View>

            </View>
          </ViewShot>
        </View>

        {/* WEB CONNECTIVITY TEST BOX */}
        <View style={styles.testBadge}>
          <Text style={styles.testText}>UPDATE DETECTED: ROW-REVERSE ACTIVE</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
    paddingHorizontal: 20, height: 60, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#EEE'
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  scrollContent: { alignItems: 'center', paddingVertical: 40 },
  
  posterCanvas: { position: 'relative', overflow: 'hidden', backgroundColor: '#FFF', borderRadius: 12 },

  // PHOTO LAYOUT
  imageWrapper: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row-reverse', // Isse photo right se shuru hogi
    alignItems: 'flex-end',
    zIndex: 1
  },
  userPhoto: {
    width: '70%',
    height: '90%',
    resizeMode: 'contain',
  },

  // TEXT LAYOUT
  textOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    justifyContent: 'flex-end',
    paddingBottom: 25,
    zIndex: 2
  },
  textCenterBox: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center'
  },
  userName: { color: '#FFF', fontSize: 32, fontWeight: '900', textAlign: 'center' },
  userDesig: { color: '#D4FC79', fontSize: 18, fontWeight: '700', marginTop: 4 },

  testBadge: { marginTop: 30, backgroundColor: '#222', padding: 10, borderRadius: 8 },
  testText: { color: '#00FF00', fontSize: 12, fontWeight: 'bold' }
});