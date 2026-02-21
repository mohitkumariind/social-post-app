import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function SupportScreen() {
  const router = useRouter();

  const openWhatsApp = () => {
    Linking.openURL('whatsapp://send?phone=919540477457&text=Hello, I need help with SocialBot');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Humein kaise sampark karein?</Text>
        
        <TouchableOpacity style={styles.card} onPress={openWhatsApp}>
          <Ionicons name="logo-whatsapp" size={30} color="#25D366" />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>WhatsApp Support</Text>
            <Text style={styles.cardDesc}>Turant sahayata ke liye message karein</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => Linking.openURL('mailto:support@socialbot.com')}>
          <Ionicons name="mail-outline" size={30} color="#EA4335" />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Email Us</Text>
            <Text style={styles.cardDesc}>support@socialbot.com</Text>
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: '900', marginBottom: 20 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: '#F9F9F9', borderRadius: 15, marginBottom: 15 },
  cardText: { marginLeft: 15 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 12, color: '#666' }
});