import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
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
import { Colors } from '../constants/Colors';
import { isPartyOtherId, normalizePartyId, PARTIES_DATA } from '../constants/Parties';
import { useLang } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';

const PROFILE_REDIRECT_DONE_KEY = '@profile_redirect_done';

type GeoItem = { id: number; name: string };

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
  const [formData, setFormData] = useState(() => ({
    ...userInfo,
    state_id: userInfo.state_id ?? null,
    loksabha_id: userInfo.loksabha_id ?? null,
    assembly_id: userInfo.assembly_id ?? null,
  }));
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [partySearch, setPartySearch] = useState('');

  const [availableStates, setAvailableStates] = useState<GeoItem[]>([]);
  const [availableLoksabhas, setAvailableLoksabhas] = useState<GeoItem[]>([]);
  const [availableAssemblies, setAvailableAssemblies] = useState<GeoItem[]>([]);
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [loksabhaPickerOpen, setLoksabhaPickerOpen] = useState(false);
  const [assemblyPickerOpen, setAssemblyPickerOpen] = useState(false);
  const [geoSearch, setGeoSearch] = useState('');

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

  useEffect(() => {
    const fetchStates = async () => {
      const { data, error } = await supabase.from('states').select('*');
      if (!error && data) {
        setAvailableStates(data.map((r: { id: number; name: string }) => ({ id: r.id, name: r.name })));
      }
    };
    fetchStates();
  }, []);

  /** Load real profile from Supabase (no dummy defaults in fields). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid || cancelled) return;

      const { data: row, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
      if (cancelled || error || !row) return;

      const p = row as Record<string, unknown>;
      const rawParty = String(p.party ?? p.party_name ?? '').trim();
      const partyCanon = normalizePartyId(rawParty) || rawParty;
      const picsRaw = p.profile_pics ?? p.profilePics;
      let profilePics: string[] = [];
      if (Array.isArray(picsRaw)) {
        profilePics = picsRaw.filter((x): x is string => typeof x === 'string' && x.length > 0);
      } else if (typeof p.avatar_url === 'string' && p.avatar_url) {
        profilePics = [p.avatar_url];
      }

      const next = {
        name: String(p.full_name ?? p.name ?? '').trim(),
        phone: String(p.phone ?? p.phone_number ?? '').trim(),
        email: String(p.email ?? '').trim(),
        designation: String(p.designation ?? '').trim(),
        designation2: String(p.designation2 ?? p.designation_2 ?? '').trim(),
        designation3: String(p.designation3 ?? p.designation_3 ?? '').trim(),
        designation4: String(p.designation4 ?? p.designation_4 ?? '').trim(),
        profilePics,
        activePhotoIndex: 0,
        partyName: partyCanon,
        state_id: typeof p.state_id === 'number' ? p.state_id : p.state_id != null ? Number(p.state_id) : null,
        loksabha_id: typeof p.loksabha_id === 'number' ? p.loksabha_id : p.loksabha_id != null ? Number(p.loksabha_id) : null,
        assembly_id: typeof p.assembly_id === 'number' ? p.assembly_id : p.assembly_id != null ? Number(p.assembly_id) : null,
        whatsapp: String(p.whatsapp ?? '').trim(),
        facebook: String(p.facebook ?? '').trim(),
        twitter: String(p.twitter ?? '').trim(),
        instagram: String(p.instagram ?? '').trim(),
      };

      if (Number.isNaN(next.state_id as number)) next.state_id = null;
      if (Number.isNaN(next.loksabha_id as number)) next.loksabha_id = null;
      if (Number.isNaN(next.assembly_id as number)) next.assembly_id = null;

      setFormData((prev) => ({ ...prev, ...next }));
      setUserInfo((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [setUserInfo]);

  useEffect(() => {
    if (formData.state_id == null) {
      setAvailableLoksabhas([]);
      return;
    }
    const fetchLoksabhas = async () => {
      const { data, error } = await supabase.from('loksabha').select('*').eq('state_id', formData.state_id!);
      if (!error && data) {
        setAvailableLoksabhas(data.map((r: { id: number; name: string }) => ({ id: r.id, name: r.name })));
      } else {
        setAvailableLoksabhas([]);
      }
    };
    fetchLoksabhas();
  }, [formData.state_id]);

  useEffect(() => {
    if (formData.loksabha_id == null) {
      setAvailableAssemblies([]);
      return;
    }
    const fetchAssemblies = async () => {
      const { data, error } = await supabase.from('assembly').select('*').eq('loksabha_id', formData.loksabha_id!);
      if (!error && data) {
        setAvailableAssemblies(data.map((r: { id: number; name: string }) => ({ id: r.id, name: r.name })));
      } else {
        setAvailableAssemblies([]);
      }
    };
    fetchAssemblies();
  }, [formData.loksabha_id]);

  const selectedState = useMemo(() => availableStates.find((s) => s.id === formData.state_id), [availableStates, formData.state_id]);
  const selectedLoksabha = useMemo(() => availableLoksabhas.find((l) => l.id === formData.loksabha_id), [availableLoksabhas, formData.loksabha_id]);
  const selectedAssembly = useMemo(() => availableAssemblies.find((a) => a.id === formData.assembly_id), [availableAssemblies, formData.assembly_id]);

  const filterGeo = (items: GeoItem[]) => {
    if (!geoSearch.trim()) return items;
    const q = geoSearch.trim().toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q));
  };

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

  const validateMandatoryFields = (): boolean => {
    const nameOk = (formData.name ?? '').trim().length > 0;
    const mobileOk = (formData.phone ?? '').trim().length > 0;
    const stateOk = formData.state_id != null;
    if (!nameOk || !mobileOk || !stateOk) {
      Alert.alert('', t('mandatory_fields_alert'));
      return false;
    }
    return true;
  };

  const handleUpdate = async () => {
    if (!validateMandatoryFields()) return;
    setUserInfo(formData);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      if (!authUser?.user?.id) {
        Alert.alert('', 'Not signed in');
        return;
      }
      const payload: Record<string, unknown> = {
        party: formData.partyName,
        party_name: formData.partyName,
        state_id: formData.state_id,
        loksabha_id: formData.loksabha_id,
        assembly_id: formData.assembly_id,
        full_name: formData.name.trim(),
        name: formData.name.trim(),
        phone: formData.phone.trim(),
      };
      const { error } = await supabase.from('profiles').update(payload).eq('id', authUser.user.id);
        if (error) {
          if (__DEV__) console.warn('Profile save failed');
          Alert.alert('', error.message ?? 'Could not save profile');
          return;
        }
      await AsyncStorage.setItem(PROFILE_REDIRECT_DONE_KEY, 'true');
    } catch (e) {
      if (__DEV__) console.warn('Profile save exception');
      Alert.alert('', 'Could not save profile');
      return;
    }
    const goAfterSave = () => {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/dashboard');
    };
    Alert.alert(t('profile_updated_title'), t('profile_updated_message'), [{ text: 'OK', onPress: goAfterSave }]);
  };

  type TextFieldOptions = {
    required?: boolean;
    keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'email-address';
    digitsOnly?: boolean;
  };

  const renderInput = (label: string, key: keyof typeof formData, icon?: string, fieldOpts?: TextFieldOptions) => (
    <View style={styles.inputRow}>
      <View style={styles.labelPart}>
        {icon && <Ionicons name={icon as any} size={20} color={Colors.textMuted} style={{ marginRight: 10 }} />}
        <Text style={styles.inputLabel}>{label}</Text>
        {fieldOpts?.required ? <Text style={styles.requiredStar}> *</Text> : null}
      </View>
      <TextInput
        style={styles.textInput}
        value={formData[key] as string}
        onChangeText={(txt) => {
          const next = fieldOpts?.digitsOnly ? txt.replace(/\D/g, '') : txt;
          setFormData({ ...formData, [key]: next });
        }}
        placeholder={label}
        placeholderTextColor="#CCC"
        textAlign="right"
        keyboardType={fieldOpts?.keyboardType ?? 'default'}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
          <Ionicons name="chevron-back" size={20} color={Colors.textMuted} />
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
          {renderInput(t('full_name'), 'name', 'person-outline', { required: true })}
          {renderInput(t('mobile'), 'phone', 'call-outline', { required: true, keyboardType: 'phone-pad', digitsOnly: true })}
          {renderInput(t('email'), 'email', 'mail-outline', { keyboardType: 'email-address' })}

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

          <TouchableOpacity style={styles.inputRow} onPress={() => setStatePickerOpen(true)} activeOpacity={0.7}>
            <View style={styles.labelPart}>
              <Ionicons name="location-outline" size={20} color="#666" style={{ marginRight: 10 }} />
              <Text style={styles.inputLabel}>{t('state')}</Text>
              <Text style={styles.requiredStar}> *</Text>
            </View>
            <View style={styles.partyValueRow}>
              <Text style={styles.partyValueText} numberOfLines={1}>{selectedState?.name ?? t('state')}</Text>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.inputRow} onPress={() => setLoksabhaPickerOpen(true)} activeOpacity={0.7}>
            <View style={styles.labelPart}>
              <Ionicons name="business-outline" size={20} color="#666" style={{ marginRight: 10 }} />
              <Text style={styles.inputLabel}>{t('loksabha')}</Text>
            </View>
            <View style={styles.partyValueRow}>
              <Text style={styles.partyValueText} numberOfLines={1}>{selectedLoksabha?.name ?? t('loksabha')}</Text>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.inputRow} onPress={() => setAssemblyPickerOpen(true)} activeOpacity={0.7}>
            <View style={styles.labelPart}>
              <Ionicons name="map-outline" size={20} color="#666" style={{ marginRight: 10 }} />
              <Text style={styles.inputLabel}>{t('assembly')}</Text>
            </View>
            <View style={styles.partyValueRow}>
              <Text style={styles.partyValueText} numberOfLines={1}>{selectedAssembly?.name ?? t('assembly')}</Text>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </View>
          </TouchableOpacity>

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
                    {isPartyOtherId(party.id) ? (
                      <View style={styles.pickerOtherIconWrap}>
                        <MaterialCommunityIcons name="account-group" size={22} color="#64748B" />
                      </View>
                    ) : null}
                    <Text style={styles.pickerItemShort}>{party.shortName}</Text>
                    <Text style={styles.pickerItemFull} numberOfLines={2}>{party.fullName}</Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={Colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={statePickerOpen} animationType="slide" transparent>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{t('state')}</Text>
              <TouchableOpacity onPress={() => { setStatePickerOpen(false); setGeoSearch(''); }} style={styles.pickerCloseBtn}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search state..."
              placeholderTextColor="#999"
              value={geoSearch}
              onChangeText={setGeoSearch}
            />
            <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
              {filterGeo(availableStates).map((s) => {
                const isSelected = formData.state_id === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setFormData({ ...formData, state_id: s.id, loksabha_id: null, assembly_id: null });
                      setStatePickerOpen(false);
                      setGeoSearch('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pickerItemFull} numberOfLines={1}>{s.name}</Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={Colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={loksabhaPickerOpen} animationType="slide" transparent>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{t('loksabha')}</Text>
              <TouchableOpacity onPress={() => { setLoksabhaPickerOpen(false); setGeoSearch(''); }} style={styles.pickerCloseBtn}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search Lok Sabha..."
              placeholderTextColor="#999"
              value={geoSearch}
              onChangeText={setGeoSearch}
            />
            <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
              {filterGeo(availableLoksabhas).map((l) => {
                const isSelected = formData.loksabha_id === l.id;
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setFormData({ ...formData, loksabha_id: l.id, assembly_id: null });
                      setLoksabhaPickerOpen(false);
                      setGeoSearch('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pickerItemFull} numberOfLines={1}>{l.name}</Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={Colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={assemblyPickerOpen} animationType="slide" transparent>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{t('assembly')}</Text>
              <TouchableOpacity onPress={() => { setAssemblyPickerOpen(false); setGeoSearch(''); }} style={styles.pickerCloseBtn}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search Assembly..."
              placeholderTextColor="#999"
              value={geoSearch}
              onChangeText={setGeoSearch}
            />
            <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
              {filterGeo(availableAssemblies).map((a) => {
                const isSelected = formData.assembly_id === a.id;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setFormData({ ...formData, assembly_id: a.id });
                      setAssemblyPickerOpen(false);
                      setGeoSearch('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pickerItemFull} numberOfLines={1}>{a.name}</Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={Colors.accent} />}
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
  saveHeaderBtn: { color: Colors.primary, fontWeight: '700', fontSize: 16 },
  sectionHeader: { backgroundColor: '#F9F9FF', paddingVertical: 10, paddingHorizontal: 20 },
  sectionHeaderText: { fontSize: 11, fontWeight: '700', color: '#666' },
  imageSection: { paddingVertical: 20, alignItems: 'center' },
  imageRow: { flexDirection: 'row', gap: 15 },
  imgCircle: { width: 85, height: 85, borderRadius: 42.5, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#EEE' },
  activeImg: { borderColor: Colors.accent, borderWidth: 2.5 },
  img: { width: '100%', height: '100%', borderRadius: 42.5 },
  pencil: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#FFF', padding: 5, borderRadius: 10, elevation: 3 },
  hintText: { fontSize: 11, color: Colors.accent, fontWeight: '600', marginTop: 10 },
  form: { paddingHorizontal: 20 },
  formHead: { fontSize: 11, fontWeight: '800', color: '#AAA', marginTop: 25, marginBottom: 5 },
  labelPart: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  inputLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  requiredStar: { fontSize: 14, color: Colors.error, fontWeight: '700' },
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  textInput: { flex: 1.5, fontSize: 14, fontWeight: '600', color: '#333' },
  partyValueRow: { flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  partyValueText: { fontSize: 14, fontWeight: '600', color: '#333', maxWidth: '90%' },
  updateBtn: { backgroundColor: Colors.secondary, margin: 25, height: 55, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginTop: 40 },
  updateBtnText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '700' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerContent: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: '#1F1F1F' },
  pickerCloseBtn: { padding: 4 },
  pickerSearch: { margin: 16, padding: 12, backgroundColor: '#F5F5F5', borderRadius: 12, fontSize: 16, color: '#333' },
  pickerScroll: { maxHeight: 360, paddingHorizontal: 20, paddingBottom: 24 },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5', flexDirection: 'row', alignItems: 'center' },
  pickerItemSelected: { backgroundColor: 'rgba(138, 43, 226, 0.06)' },
  pickerOtherIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerItemShort: { fontSize: 15, fontWeight: '700', color: '#1F1F1F', width: 72 },
  pickerItemFull: { flex: 1, fontSize: 13, color: '#555' },
});
