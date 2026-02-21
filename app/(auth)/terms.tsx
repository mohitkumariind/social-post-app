import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

export default function TermsConditionsScreen() {
  const router = useRouter();
  const APP_NAME = "Social Post"; // Aapka App Name

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
        <Text style={styles.headerTitle}>Terms & Conditions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.introBox}>
          <View style={styles.iconCircle}>
            <Ionicons name="document-text-sharp" size={40} color="#182848" />
          </View>
          <Text style={styles.appName}>{APP_NAME} User Agreement</Text>
          <Text style={styles.lastUpdated}>Version 1.0 - Feb 20, 2026</Text>
        </View>

        <View style={styles.contentCard}>
          <Section 
            title="1. Acceptance of Terms" 
            content={`By downloading and using ${APP_NAME}, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use the application.`} 
          />

          <Section 
            title="2. Eligibility" 
            content="You must be at least 18 years of age and a resident of India to participate in the digital advocacy missions. You are responsible for ensuring that your use of the app complies with local laws." 
          />

          <Section 
            title="3. User Conduct" 
            content="Users agree not to use the app for any illegal purposes. Any attempt to manipulate the points system, create fake accounts, or spread misinformation/hate speech will lead to an immediate ban." 
          />

          <Section 
            title="4. Reward Points & Ranks" 
            content="Reward points and ranks (Badges) are virtual and hold no real-world monetary value. They are intended for gamification and motivational purposes only. The app administration reserves the right to reset or adjust points at its discretion." 
          />

          <Section 
            title="5. Intellectual Property" 
            content="All content, logos, and designs within the app are the property of the organization. Users are granted a limited license to share the provided posts on social media platforms." 
          />

          <Section 
            title="6. Limitation of Liability" 
            content={`${APP_NAME} is not responsible for any issues arising from third-party social media platforms (WhatsApp, Facebook, etc.) or any loss of data due to technical errors.`} 
          />

          <Section 
            title="7. Termination" 
            content="We reserve the right to terminate or suspend your access to the application without prior notice for any violation of these terms." 
          />

          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              Important: These terms are subject to change at any time. Users are encouraged to review them periodically.
            </Text>
          </View>
        </View>

        <Text style={styles.footerNote}>© 2026 {APP_NAME}. For internal use only.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F7FA' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 15, 
    height: 60, 
    backgroundColor: '#FFF',
    elevation: 2,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#182848' },
  
  scrollContent: { padding: 20 },
  introBox: { alignItems: 'center', marginBottom: 25 },
  iconCircle: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#E0E7FF', justifyContent: 'center', alignItems: 'center' },
  appName: { fontSize: 22, fontWeight: '900', color: '#182848', marginTop: 15 },
  lastUpdated: { fontSize: 12, color: '#999', marginTop: 5 },

  contentCard: { backgroundColor: '#FFF', borderRadius: 25, padding: 20, elevation: 2, borderWidth: 1, borderColor: '#EEE' },
  section: { marginBottom: 22 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#182848', marginBottom: 6 },
  sectionContent: { fontSize: 13, color: '#444', lineHeight: 20 },

  noticeBox: { marginTop: 10, padding: 15, backgroundColor: '#FFFBEB', borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  noticeText: { fontSize: 12, color: '#92400E', fontWeight: '600', fontStyle: 'italic' },

  footerNote: { textAlign: 'center', fontSize: 11, color: '#BBB', marginTop: 30, marginBottom: 20 }
});