import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const parties = [
  { id: 'bjp', name: 'Bharatiya Janata Party', short: 'BJP', color: '#FF9933' },
  { id: 'inc', name: 'Indian National Congress', short: 'INC', color: '#19AAED' },
  { id: 'aap', name: 'Aam Aadmi Party', short: 'AAP', color: '#0072B0' },
  { id: 'sp', name: 'Samajwadi Party', short: 'SP', color: '#FF0000' },
  { id: 'bsp', name: 'Bahujan Samaj Party', short: 'BSP', color: '#0000FF' },
  { id: 'rld', name: 'Rashtriya Lok Dal', short: 'RLD', color: '#008000' },
  { id: 'apna_dal', name: 'Apna Dal (S)', short: 'AD(S)', color: '#5D2D91' },
  { id: 'jansatta', name: 'Jansatta Dal Loktantrik', short: 'JDL', color: '#FFD700' },
  { id: 'rjd', name: 'Rashtriya Janata Dal', short: 'RJD', color: '#008000' },
  { id: 'jdu', name: 'Janata Dal (United)', short: 'JD(U)', color: '#006400' },
  { id: 'ljp', name: 'Lok Janshakti Party (RV)', short: 'LJP', color: '#0000FF' },
  { id: 'other', name: 'Other / Local Party', short: 'Other', color: '#666666' },
];

export default function PartyScreen() {
  const router = useRouter();
  const [selectedParty, setSelectedParty] = useState('');

  const handleContinue = () => {
    if (selectedParty) {
      router.push('/(auth)/login');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header with White Background & Black Text */}
      <View style={styles.header}>
        <Text style={styles.title}>Select Your Political Party</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {parties.map((party) => {
          const isSelected = selectedParty === party.id;
          return (
            <TouchableOpacity 
              key={party.id} 
              style={[
                styles.partyCard, 
                isSelected && { borderColor: '#000', borderWidth: 1.5, backgroundColor: '#F9F9F9' }
              ]}
              onPress={() => setSelectedParty(party.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.colorIndicator, { backgroundColor: party.color }]} />
              <View style={styles.partyInfo}>
                <Text style={styles.partyName}>{party.name}</Text>
                <Text style={styles.partyShort}>{party.short}</Text>
              </View>
              {isSelected ? (
                <Ionicons name="checkmark-circle" size={24} color="#000" />
              ) : (
                <View style={styles.emptyCircle} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Sticky Footer */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.btn, !selectedParty && styles.btnDisabled]} 
          onPress={handleContinue}
          disabled={!selectedParty}
        >
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#FFFFFF' 
  },
  header: { 
    paddingHorizontal: 20, 
    paddingTop: 80, 
    paddingBottom: 30, 
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: { 
    fontFamily: Platform.OS === 'ios' ? 'Montserrat' : 'sans-serif-medium', 
    fontWeight: '600', 
    fontSize: 20, 
    lineHeight: 28, 
    textAlign: 'center',
    color: '#1F1F1F', // Black text for White Background
    letterSpacing: 0,
  },
  list: { padding: 20, paddingBottom: 120 },
  partyCard: { 
    backgroundColor: '#FFFFFF', 
    padding: 18, 
    borderRadius: 15, 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    ...Platform.select({
      web: { boxShadow: '0px 2px 8px rgba(0,0,0,0.05)' },
      android: { elevation: 2 }
    })
  },
  colorIndicator: { width: 5, height: 35, borderRadius: 3, marginRight: 15 },
  partyInfo: { flex: 1 },
  partyName: { 
    fontSize: 17, 
    fontWeight: '600', 
    color: '#000',
    fontFamily: Platform.OS === 'ios' ? 'Montserrat' : 'sans-serif-medium',
  },
  partyShort: { fontSize: 12, color: '#999', marginTop: 2 },
  emptyCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#EEE',
  },
  footer: { 
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20, 
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0'
  },
  btn: { 
    backgroundColor: '#1F1F1F', // Black button on white background looks premium
    padding: 18, 
    borderRadius: 15, 
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#E0E0E0' },
  btnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' }
});