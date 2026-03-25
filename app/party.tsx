import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../constants/Colors';
import { isPartyOtherId, PARTIES_DATA, PARTIES_FIRST_8, PARTIES_MORE } from '../constants/Parties';
import { useLang } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';

const PARTY_INDICATOR_COLOR = '#8A2BE2';

export default function PartyScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { userInfo, setUserInfo } = useUser();
  const [selectedParty, setSelectedParty] = useState(userInfo?.partyName || '');
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSelect = (partyId: string) => {
    setSelectedParty(partyId);
    if (showMore) setShowMore(false);
  };

  const handleContinue = async () => {
    if (!selectedParty) return;
    setSaving(true);
    try {
      setUserInfo((prev) => ({ ...prev, partyName: selectedParty }));
      const { data: authUser } = await supabase.auth.getUser();
      if (authUser?.user?.id) {
        await supabase.from('profiles').update({ party: selectedParty }).eq('id', authUser.user.id);
      }
    } catch (e) {
      if (__DEV__) console.warn('Party backend update failed');
    } finally {
      setSaving(false);
      router.replace('/dashboard');
    }
  };

  const renderPartyCard = (party: { id: string; shortName: string; fullName: string }) => {
    const isSelected = selectedParty === party.id;
    return (
      <TouchableOpacity
        key={party.id}
        style={[styles.partyCard, isSelected && styles.partyCardSelected]}
        onPress={() => handleSelect(party.id)}
        activeOpacity={0.7}
      >
        {isPartyOtherId(party.id) ? (
          <View style={styles.partyIconLead} accessibilityLabel="Other">
            <MaterialCommunityIcons name="account-group" size={26} color="#64748B" />
          </View>
        ) : (
          <View style={[styles.colorIndicator, { backgroundColor: PARTY_INDICATOR_COLOR }]} />
        )}
        <View style={styles.partyInfo}>
          <Text style={styles.partyName}>{party.fullName}</Text>
          <Text style={styles.partyShort}>{party.shortName}</Text>
        </View>
        {isSelected ? (
          <Ionicons name="checkmark-circle" size={24} color="#000" />
        ) : (
          <View style={styles.emptyCircle} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('select_party_title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {PARTIES_FIRST_8.map(renderPartyCard)}

        <TouchableOpacity
          style={styles.moreCard}
          onPress={() => setShowMore(true)}
          activeOpacity={0.7}
        >
          <View style={[styles.colorIndicator, { backgroundColor: '#666' }]} />
          <View style={styles.partyInfo}>
            <Text style={styles.moreCardTitle}>More parties</Text>
            <Text style={styles.partyShort}>View all {PARTIES_DATA.length} parties</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#666" />
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showMore} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Party</Text>
              <TouchableOpacity onPress={() => setShowMore(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {PARTIES_MORE.map(renderPartyCard)}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, (!selectedParty || saving) && styles.btnDisabled]}
          onPress={handleContinue}
          disabled={!selectedParty || saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <Text style={styles.btnText}>{t('continue')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: 80,
    paddingBottom: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Platform.OS === 'ios' ? 'Montserrat' : 'sans-serif-medium',
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
    color: Colors.text,
    letterSpacing: 0,
  },
  list: { padding: 20, paddingBottom: 120 },
  partyCard: {
    backgroundColor: Colors.cardBg,
    padding: 20,
    borderRadius: Colors.borderRadius,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
    ...Platform.select({
      web: { boxShadow: '0px 2px 8px rgba(0,0,0,0.05)' },
      android: { elevation: 2 },
    }),
  },
  partyCardSelected: { backgroundColor: 'rgba(142, 36, 170, 0.06)' },
  /** Neutral lead for &quot;Other&quot; (account-group) — width aligns with color bar column */
  partyIconLead: {
    width: 36,
    height: 36,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
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
  moreCard: {
    backgroundColor: '#F9F9F9',
    padding: 18,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  moreCardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Montserrat' : 'sans-serif-medium',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1F1F1F' },
  modalCloseBtn: { padding: 4 },
  modalScroll: { maxHeight: 400, padding: 20 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  btn: {
    backgroundColor: Colors.primary,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: Colors.border },
  btnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
});
