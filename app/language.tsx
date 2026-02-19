import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const languages = [
  { id: 'en', label: 'English', sub: 'Global Language' },
  { id: 'hi', label: 'हिंदी', sub: 'राष्ट्रीय भाषा' },
  { id: 'pa', label: 'ਪੰਜਾਬੀ', sub: 'ਖੇਤਰੀ ਭਾਸ਼ਾ' },
  { id: 'mr', label: 'मराठी', sub: 'प्रादेशिक भाषा' },
  { id: 'gu', label: 'ગુજરાતી', sub: 'પ્રાદેશિક ભાષા' },
];

export default function LanguageScreen() {
  const router = useRouter();
  const [selectedLang, setSelectedLang] = useState('');

  const handleConfirm = () => {
    if (selectedLang) {
      console.log("Language Confirmed:", selectedLang);
      router.push('/party');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header Section */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoLetter}>S</Text>
        </View>
        <Text style={styles.title}>Select Language</Text>
        <Text style={styles.subtitle}>अपनी पसंदीदा भाषा चुनें</Text>
      </View>

      {/* Language List */}
      <ScrollView contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false}>
        {languages.map((item) => (
          <TouchableOpacity 
            key={item.id} 
            style={[
              styles.card, 
              selectedLang === item.id && styles.selectedCard
            ]} 
            onPress={() => setSelectedLang(item.id)}
            activeOpacity={0.7}
          >
            <View style={styles.cardContent}>
              <View style={[styles.iconCircle, selectedLang === item.id && styles.selectedIconCircle]}>
                <Ionicons 
                  name="language-outline" 
                  size={24} 
                  color={selectedLang === item.id ? '#FFF' : '#FCAC12'} 
                />
              </View>
              <View style={styles.textGroup}>
                <Text style={[styles.label, selectedLang === item.id && styles.selectedLabel]}>
                  {item.label}
                </Text>
                <Text style={styles.subLabel}>{item.sub}</Text>
              </View>
            </View>
            {selectedLang === item.id ? (
              <Ionicons name="checkmark-circle" size={28} color="#FCAC12" />
            ) : (
              <View style={styles.emptyCircle} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Action Button Section */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.chooseBtn, !selectedLang && styles.disabledBtn]} 
          onPress={handleConfirm}
          disabled={!selectedLang}
        >
          <Text style={styles.chooseBtnText}>Choose</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: { 
    backgroundColor: '#FCAC12', 
    paddingTop: 60, 
    paddingBottom: 30, 
    alignItems: 'center',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  logoCircle: {
    width: 50,
    height: 50,
    backgroundColor: '#FFF',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  logoLetter: { fontSize: 24, fontWeight: 'bold', color: '#FCAC12' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#FFF' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  listContainer: { padding: 20, paddingBottom: 100 },
  card: { 
    backgroundColor: '#FFF', 
    padding: 18, 
    borderRadius: 20, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'transparent',
    ...Platform.select({
      web: { boxShadow: '0px 4px 10px rgba(0,0,0,0.03)' },
      android: { elevation: 2 }
    })
  },
  selectedCard: {
    borderColor: '#FCAC12',
    backgroundColor: '#FFFBEF',
  },
  cardContent: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: {
    width: 45,
    height: 45,
    backgroundColor: '#FFF9EF',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  selectedIconCircle: { backgroundColor: '#FCAC12' },
  textGroup: { justifyContent: 'center' },
  label: { fontSize: 18, fontWeight: '700', color: '#333' },
  selectedLabel: { color: '#FCAC12' },
  subLabel: { fontSize: 12, color: '#999', marginTop: 2 },
  emptyCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#EEE',
  },
  footer: { 
    position: 'absolute', 
    bottom: 0, 
    left: 0, 
    right: 0, 
    padding: 20, 
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#EEE'
  },
  chooseBtn: { 
    backgroundColor: '#FCAC12', 
    padding: 18, 
    borderRadius: 15, 
    alignItems: 'center' 
  },
  disabledBtn: { backgroundColor: '#E0E0E0' },
  chooseBtnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' }
});