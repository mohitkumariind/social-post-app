import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  
  // Aapka asli App Name yahan aayega
  const APP_NAME = "Social Post"; 

  const Section = ({ title, content }: { title: string, content: string }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionContent}>{content}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* --- HEADER --- */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="close" size={26} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        {/* --- BRANDING SECTION --- */}
        <View style={styles.introBox}>
          <Ionicons name="shield-checkmark-sharp" size={50} color="#182848" />
          <Text style={styles.appName}>{APP_NAME}</Text>
          <Text style={styles.lastUpdated}>Last Updated: Feb 20, 2026</Text>
        </View>

        {/* --- CONTENT CARD --- */}
        <View style={styles.contentCard}>
          <Section 
            title="1. Introduction" 
            content={`Welcome to ${APP_NAME}. We value your privacy and are committed to protecting your personal data. This policy explains how we handle your information when you use our services.`} 
          />

          <Section 
            title="2. Information We Collect" 
            content="We collect your Name and Phone Number during login. Additionally, we track social media sharing activity (WhatsApp, Facebook, Instagram) strictly to calculate reward points and achievement ranks." 
          />

          <Section 
            title="3. How We Use Data" 
            content={`Your data is used to maintain your profile, track your contribution to the missions within ${APP_NAME}, and ensure the integrity of our leaderboard system.`} 
          />

          <Section 
            title="4. Data Security" 
            content="We use industry-standard encryption to protect your phone number and activity logs. Your personal data is never sold to third-party marketing agencies." 
          />

          <Section 
            title="5. Third-Party Services" 
            content="Our app interacts with external social platforms for content sharing. Please note that once you leave our app to share content, the privacy policy of that specific platform applies." 
          />

          <Section 
            title="6. User Rights" 
            content="You have the right to request the deletion of your account and data at any time through the support section of the app." 
          />

          {/* --- CONTACT BOX --- */}
          <View style={styles.contactBox}>
            <Text style={styles.contactTitle}>Questions?</Text>
            <Text style={styles.contactText}>Contact us at: support@socialpost.com</Text>
          </View>
        </View>

        <Text style={styles.footerNote}>© 2026 {APP_NAME}. All Rights Reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 15, 
    height: 60, 
    backgroundColor: '#FFF',
    elevation: 2,
    marginTop: Platform.OS === 'android' ? 0 : 0,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  
  scrollContent: { padding: 20 },
  introBox: { alignItems: 'center', marginBottom: 30 },
  appName: { fontSize: 24, fontWeight: '900', color: '#182848', marginTop: 10 },
  lastUpdated: { fontSize: 12, color: '#999', marginTop: 5 },

  contentCard: { 
    backgroundColor: '#FFF', 
    borderRadius: 20, 
    padding: 20, 
    elevation: 1, 
    borderWidth: 1, 
    borderColor: '#EEE' 
  },
  section: { marginBottom: 25 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#182848', marginBottom: 8 },
  sectionContent: { fontSize: 14, color: '#555', lineHeight: 22 },

  contactBox: { marginTop: 10, padding: 15, backgroundColor: '#F0F4FF', borderRadius: 12, alignItems: 'center' },
  contactTitle: { fontSize: 15, fontWeight: '800', color: '#182848' },
  contactText: { fontSize: 13, color: '#4B6CB7', marginTop: 5 },

  footerNote: { textAlign: 'center', fontSize: 11, color: '#BBB', marginTop: 30, marginBottom: 20 }
});