import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    Alert,
    Dimensions,
    Platform,
    SafeAreaView,
    ScrollView,
    Share,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const { width } = Dimensions.get('window');

export default function ReferEarnScreen() {
  const router = useRouter();

  // Yahan apna Play Store ka link daalein
  const playStoreLink = "https://play.google.com/store/apps/details?id=com.socialpost.app"; 

  const onShare = async () => {
    try {
      const message = `🚩 *Jai Hind!* \n\nMain Party ki Digital Army se jud gaya hoon. Aap bhi is app ko download karein aur desh ke liye apna yogdaan dein! \n\nDirect Download Link: \n${playStoreLink}`;
      
      await Share.share({
        message: message,
      });
    } catch (error: any) {
      Alert.alert("Error", "Sharing mein dikkat aa rahi hai.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* --- HEADER --- */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sena Vistar (Invite)</Text>
        <View style={{ width: 40 }} /> 
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        
        {/* --- HERO BANNER --- */}
        <View style={styles.heroSection}>
          <LinearGradient 
            colors={['#182848', '#4B6CB7']} 
            style={styles.heroCard}
          >
            <View style={styles.heroIconWrap}>
               <Ionicons name="megaphone-outline" size={50} color="#FFD700" />
            </View>
            <Text style={styles.heroTitle}>Sena Badhayein!</Text>
            <Text style={styles.heroSub}>Naye saathiyon ko jodein aur Party ki awaaz ko buland karein.</Text>
          </LinearGradient>
        </View>

        {/* --- INVITE ACTION CARD --- */}
        <View style={styles.inviteCard}>
          <Ionicons name="logo-whatsapp" size={60} color="#25D366" />
          <Text style={styles.inviteTitle}>WhatsApp par Bhejein</Text>
          <Text style={styles.inviteDesc}>
            Niche diye gaye button par click karke apne dosto aur group mein Play Store ka link share karein.
          </Text>

          <TouchableOpacity style={styles.shareBtn} onPress={onShare} activeOpacity={0.8}>
            <LinearGradient colors={['#25D366', '#128C7E']} style={styles.btnGradient}>
               <Ionicons name="share-social" size={20} color="#FFF" />
               <Text style={styles.shareBtnText}>Invite Now</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* --- STATS (Optional - Keeping it simple) --- */}
        <View style={styles.infoSection}>
           <View style={styles.infoRow}>
              <Ionicons name="flash-outline" size={20} color="#4B6CB7" />
              <Text style={styles.infoText}>Link share karte hi aapki Digital Army badhne lagegi.</Text>
           </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 15, 
    height: 60, 
    backgroundColor: '#FFF',
    elevation: 3,
    marginTop: Platform.OS === 'android' ? 0 : 0, 
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#182848' },
  
  heroSection: { padding: 20 },
  heroCard: { padding: 30, borderRadius: 30, alignItems: 'center', elevation: 8 },
  heroIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#FFF', marginTop: 15 },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 8, lineHeight: 20 },

  inviteCard: { marginHorizontal: 20, backgroundColor: '#FFF', padding: 30, borderRadius: 30, elevation: 5, alignItems: 'center', marginTop: 10 },
  inviteTitle: { fontSize: 20, fontWeight: '800', color: '#333', marginTop: 15 },
  inviteDesc: { fontSize: 13, color: '#666', textAlign: 'center', marginTop: 10, lineHeight: 20, paddingHorizontal: 10 },
  
  shareBtn: { width: '100%', marginTop: 25, elevation: 5 },
  btnGradient: { flexDirection: 'row', paddingVertical: 16, borderRadius: 20, justifyContent: 'center', alignItems: 'center', gap: 10 },
  shareBtnText: { color: '#FFF', fontWeight: '800', fontSize: 18 },

  infoSection: { padding: 30 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F0F4FF', padding: 15, borderRadius: 15 },
  infoText: { fontSize: 12, color: '#4B6CB7', fontWeight: '600', flex: 1 }
});