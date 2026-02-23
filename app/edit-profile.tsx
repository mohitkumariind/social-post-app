import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { PARTIES_DATA } from '../constants/Parties';
import { useLang } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';

function getPartyByIdOrShort(value: string) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return (
    PARTIES_DATA.find(
      (p) => p.id === v || p.shortName.toUpperCase() === value.trim().toUpperCase()
    ) ?? null
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { userInfo, setUserInfo } = useUser();
  const [formData, setFormData] = useState({ ...userInfo });
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [partySearch, setPartySearch] = useState('');

  const selectedParty = useMemo(
    () => getPartyByIdOrShort(formData.partyName),
    [formData.partyName]
  );

  const filteredParties = useMemo(() => {
    if (!partySearch.trim()) return PARTIES_DATA;
    const q = partySearch.trim().toLowerCase();
    return PARTIES_DATA.filter(
      (p) =>
        p.shortName.toLowerCase().includes(q) ||
        p.fullName.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [partySearch]);

  const pickImage = async (index: number) => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 1,
    });
    if (!result.canceled) {
      let newPics = [...formData.profilePics];
      newPics[index] = result.assets[0].uri;
      setFormData({ ...formData, profilePics: newPics });
    }
  };

  const handleUpdate = () => {
    setUserInfo(formData);
    Alert.alert(t('profile_updated_title'), t('profile_updated_message'));
    router.back();
  };

  const renderInput = (label: string, key: keyof typeof formData, icon?: string) => (
    <View style={styles.inputRow}>
      <View style={styles.labelPart}>
        {icon && <Ionicons name={icon as any} size={20} color="#666" style={{ marginRight: 10 }} />}
        <Text style={styles.inputLabel}>{label}</Text>
      </View>
      <TextInput
        style={styles.textInput}
        value={formData[key] as string}
        onChangeText={(txt) => setFormData({ ...formData, [key]: txt })}
        placeholder={label}
        placeholderTextColor="#CCC"
        textAlign="right"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
          <Ionicons name="chevron-back" size={20} color="#666" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('edit_profile')}</Text>
        <TouchableOpacity onPress={handleUpdate}><Text style={styles.saveHeaderBtn}>{t('save')}</Text></TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>{t('photo_manager')}</Text></View>
        <View style={styles.imageSection}>
          <View style={styles.imageRow}>
            {[0, 1, 2].map((i) => (
              <TouchableOpacity key={i} style={[styles.imgCircle, formData.activePhotoIndex === i && styles.activeImg]} onPress={() => setFormData({ ...formData, activePhotoIndex: i })}>
                {formData.profilePics[i] ? <Image source={{ uri: formData.profilePics[i] }} style={styles.img} /> : <Ionicons name="add" size={28} color="#CCC" />}
                <TouchableOpacity style={styles.pencil} onPress={() => pickImage(i)}><Ionicons name="pencil" size={10} color="#333" /></TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hintText}>{t('tap_photo_hint')}</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formHead}>{t('personal_info')}</Text>
          {renderInput(t('full_name'), 'name', 'person-outline')}
          {renderInput(t('mobile'), 'phone', 'call-outline')}
          {renderInput(t('email'), 'email', 'mail-outline')}

          <Text style={styles.formHead}>{t('political_profile')}</Text>

          <TouchableOpacity
            style={styles.inputRow}
            onPress={() => setPartyPickerOpen(true)}
            activeOpacity={0.7}
          >
            <View style={styles.labelPart}>
              <Ionicons name="flag-outline" size={20} color="#666" style={{ marginRight: 10 }} />
              <Text style={styles.inputLabel}>{t('party_name')}</Text>
            </View>
            <View style={styles.partyValueRow}>
              <Text style={styles.partyValueText} numberOfLines={1}>
                {selectedParty ? `${selectedParty.shortName} – ${selectedParty.fullName}` : t('party_name')}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </View>
          </TouchableOpacity>

          {renderInput(t('designation_1'), 'designation', 'ribbon-outline')}
          {renderInput(t('designation_2'), 'designation2', 'ribbon-outline')}
          {renderInput(t('designation_3'), 'designation3', 'ribbon-outline')}
          {renderInput(t('designation_4'), 'designation4', 'ribbon-outline')}
          {renderInput(t('state'), 'state', 'location-outline')}
          {renderInput(t('district'), 'district', 'business-outline')}
          {renderInput(t('assembly'), 'assembly', 'map-outline')}

          <Text style={styles.formHead}>{t('social_links')}</Text>
          {renderInput('WhatsApp', 'whatsapp', 'logo-whatsapp')}
          {renderInput('Facebook', 'facebook', 'logo-facebook')}
          {renderInput('Instagram', 'instagram', 'logo-instagram')}
          {renderInput('Twitter (X)', 'twitter', 'logo-twitter')}
        </View>

        <TouchableOpacity style={styles.updateBtn} onPress={handleUpdate}>
          <Text style={styles.updateBtnText}>{t('save_all_changes')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={partyPickerOpen} animationType="slide" transparent>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{t('party_name')}</Text>
              <TouchableOpacity onPress={() => { setPartyPickerOpen(false); setPartySearch(''); }} style={styles.pickerCloseBtn}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search party..."
              placeholderTextColor="#999"
              value={partySearch}
              onChangeText={setPartySearch}
            />
            <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
              {filteredParties.map((party) => {
                const isSelected = formData.partyName === party.id;
                return (
                  <TouchableOpacity
                    key={party.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setFormData({ ...formData, partyName: party.id });
                      setPartyPickerOpen(false);
                      setPartySearch('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pickerItemShort}>{party.shortName}</Text>
                    <Text style={styles.pickerItemFull} numberOfLines={2}>{party.fullName}</Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color="#8A2BE2" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', marginTop: Platform.OS === 'android' ? 30 : 0 },
  backCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  saveHeaderBtn: { color: '#8A2BE2', fontWeight: '700', fontSize: 16 },
  sectionHeader: { backgroundColor: '#F9F9FF', paddingVertical: 10, paddingHorizontal: 20 },
  sectionHeaderText: { fontSize: 11, fontWeight: '700', color: '#666' },
  imageSection: { paddingVertical: 20, alignItems: 'center' },
  imageRow: { flexDirection: 'row', gap: 15 },
  imgCircle: { width: 85, height: 85, borderRadius: 42.5, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#EEE' },
  activeImg: { borderColor: '#8A2BE2', borderWidth: 2.5 },
  img: { width: '100%', height: '100%', borderRadius: 42.5 },
  pencil: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#FFF', padding: 5, borderRadius: 10, elevation: 3 },
  hintText: { fontSize: 11, color: '#8A2BE2', fontWeight: '600', marginTop: 10 },
  form: { paddingHorizontal: 20 },
  formHead: { fontSize: 11, fontWeight: '800', color: '#AAA', marginTop: 25, marginBottom: 5 },
  labelPart: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  inputLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  textInput: { flex: 1.5, fontSize: 14, fontWeight: '600', color: '#333' },
  partyValueRow: { flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  partyValueText: { fontSize: 14, fontWeight: '600', color: '#333', maxWidth: '90%' },
  updateBtn: { backgroundColor: '#2ECC71', margin: 25, height: 55, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginTop: 40 },
  updateBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerContent: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: '#1F1F1F' },
  pickerCloseBtn: { padding: 4 },
  pickerSearch: { margin: 16, padding: 12, backgroundColor: '#F5F5F5', borderRadius: 12, fontSize: 16, color: '#333' },
  pickerScroll: { maxHeight: 360, paddingHorizontal: 20, paddingBottom: 24 },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5', flexDirection: 'row', alignItems: 'center' },
  pickerItemSelected: { backgroundColor: 'rgba(138, 43, 226, 0.06)' },
  pickerItemShort: { fontSize: 15, fontWeight: '700', color: '#1F1F1F', width: 72 },
  pickerItemFull: { flex: 1, fontSize: 13, color: '#555' },
});
