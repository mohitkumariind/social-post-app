import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
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
import { type UserInfo, useUser } from '../context/UserContext';
import { supabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPartiesSafe } from '../lib/parties';

const PROFILE_REDIRECT_DONE_KEY = '@profile_redirect_done';

/** Supabase Storage — must match bucket created in SQL / dashboard */
const AVATARS_BUCKET = 'post-images';

type GeoItem = { id: number; name: string };

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/\s/g, '');
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoder not available on this device');
  }
  const binary = globalThis.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function uploadViaStorageRest(localUri: string, objectPath: string, accessToken: string): Promise<void> {
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${AVATARS_BUCKET}/${objectPath}`;
  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    // Supabase Storage REST expects API key + user JWT.
    // PUT is the most compatible verb for "upsert" style uploads.
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'x-upsert': 'true',
      'Content-Type': 'image/jpeg',
      Accept: 'application/json',
    },
  });
  if (result.status < 200 || result.status >= 300) {
    // Supabase often includes a JSON error body; surface it for debugging.
    const body = typeof result.body === 'string' ? result.body : '';
    if (__DEV__) {
      console.warn('[EditProfile] Storage REST upload failed', {
        status: result.status,
        body: body?.slice?.(0, 800) ?? body,
      });
    }
    throw new Error(`Storage REST upload failed (${result.status})${body ? `: ${body}` : ''}`);
  }
}

async function uploadImage(localUri: string, userId: string): Promise<string> {
  let uploadBody: Blob | ArrayBuffer;
  try {
    const response = await fetch(localUri);
    if (!response.ok) {
      throw new Error(`Could not read image URI (${response.status})`);
    }
    uploadBody = await response.blob();
  } catch (fetchErr) {
    if (__DEV__) console.warn('[EditProfile] fetch(uri) failed, using FileSystem fallback:', fetchErr);
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    uploadBody = base64ToArrayBuffer(base64);
  }
  // Keep avatar uploads isolated from post graphics.
  // Bucket: post-images, Folder: avatars/
  const fileName = `${userId}-${Date.now()}.jpg`;
  const path = `avatars/${fileName}`;

  try {
    const { error } = await supabase.storage.from(AVATARS_BUCKET).upload(path, uploadBody, {
      upsert: true,
      contentType: 'image/jpeg',
    });
    if (error) throw error;
  } catch (uploadErr) {
    if (__DEV__) console.warn('[EditProfile] supabase-js upload failed, trying REST fallback:', uploadErr);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw uploadErr;
    await uploadViaStorageRest(localUri, path, accessToken);
  }
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Local form: DB fields + `stateId` for `states` / `loksabha` joins only (not persisted). */
type ProfileFormData = UserInfo & { stateId: number | null };

/** Map Supabase `states` / `loksabha` / `assembly` rows — column names vary (see admin posts page). */
function mapGeoRow(r: Record<string, unknown>): GeoItem | null {
  const rawId = r.id;
  const idNum = typeof rawId === 'number' && !Number.isNaN(rawId) ? rawId : Number(rawId);
  if (rawId == null || Number.isNaN(idNum)) return null;
  const name = String(r.name ?? r.state_name ?? r.loksabha_name ?? r.assembly_name ?? r.state ?? '').trim();
  if (!name) return null;
  return { id: idNum, name };
}

function getPartyByIdOrShort(value: string) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return (
    PARTIES_DATA.find(
      (p) => p.id === v || p.shortName.toUpperCase() === value.trim().toUpperCase()
    ) ?? null
  );
}

export type EditProfileScreenProps = {
  /** Dashboard gate: no back button / stack pop; parent Modal unmounts when profile is complete. */
  embedMode?: boolean;
  /** Parent callback (Dashboard) to force refetch/cache-bust after successful save. */
  onSaved?: () => void;
  /** When embedded in modal, reload profile each time modal opens. */
  isVisible?: boolean;
};

export function EditProfileScreen({ embedMode = false, onSaved, isVisible = true }: EditProfileScreenProps = {}) {
  const router = useRouter();
  const { t } = useLang();
  const { userInfo, setUserInfo } = useUser();
  const [formData, setFormData] = useState<ProfileFormData>(() => ({
    ...userInfo,
    avatar_url: userInfo.avatar_url ?? '',
    stateId: null,
    loksabha_id: userInfo.loksabha_id ?? null,
    assembly_id: userInfo.assembly_id ?? null,
  }));
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [partySearch, setPartySearch] = useState('');
  const [parties, setParties] = useState(PARTIES_DATA);

  const [availableStates, setAvailableStates] = useState<GeoItem[]>([]);
  const [availableLoksabhas, setAvailableLoksabhas] = useState<GeoItem[]>([]);
  const [availableAssemblies, setAvailableAssemblies] = useState<GeoItem[]>([]);
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [loksabhaPickerOpen, setLoksabhaPickerOpen] = useState(false);
  const [assemblyPickerOpen, setAssemblyPickerOpen] = useState(false);
  const [geoSearch, setGeoSearch] = useState('');
  const [statesLoading, setStatesLoading] = useState(true);
  const [fetchUiError, setFetchUiError] = useState<string | null>(null);
  const loksabhaReqIdRef = useRef(0);
  const assemblyReqIdRef = useRef(0);

  const selectedParty = useMemo(
    () => {
      if (!formData.partyName) return null;
      const v = formData.partyName.trim().toLowerCase();
      return (
        parties.find(
          (p) => p.id === v || p.shortName.toUpperCase() === formData.partyName.trim().toUpperCase()
        ) ?? null
      );
    },
    [formData.partyName, parties]
  );

  const filteredParties = useMemo(() => {
    if (!partySearch.trim()) return parties;
    const q = partySearch.trim().toLowerCase();
    return parties.filter(
      (p) =>
        p.shortName.toLowerCase().includes(q) ||
        p.fullName.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [partySearch, parties]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getPartiesSafe();
      if (!cancelled && Array.isArray(list) && list.length > 0) setParties(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchStates = async () => {
      setStatesLoading(true);
      try {
        const { data, error } = await supabase.from('states').select('*');
        if (error) {
          if (__DEV__) console.warn('[EditProfile] fetchStates Supabase error:', error.message, error);
          if (!cancelled) {
            setAvailableStates([]);
            setFetchUiError(error.message || 'Could not load states');
          }
          return;
        }
        const raw = data ?? [];

        const mapped: GeoItem[] = [];
        for (const row of raw) {
          const item = mapGeoRow(row as Record<string, unknown>);
          if (item) mapped.push(item);
        }
        mapped.sort((a, b) => a.name.localeCompare(b.name));

        if (!cancelled) {
          setAvailableStates(mapped);
          setFetchUiError(null);
        }
      } finally {
        if (!cancelled) setStatesLoading(false);
      }
    };
    void fetchStates();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Match `profiles.state` string to `states.id` for loksabha queries */
  useEffect(() => {
    const st = (formData.state ?? '').trim();
    if (!st || availableStates.length === 0) return;
    const m = availableStates.find((s) => s.name === st);
    if (m && formData.stateId !== m.id) {
      setFormData((prev) => ({ ...prev, stateId: m.id }));
    }
  }, [formData.state, availableStates, formData.stateId]);

  /** Load real profile from Supabase (no dummy defaults in fields). */
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid || cancelled) return;

      const { data: row, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
      if (cancelled) return;
      if (error) {
        if (__DEV__) {
          console.warn('[EditProfile] profile load error:', error.message, {
            code: error.code,
            details: error.details,
            hint: error.hint,
          });
        }
        setFetchUiError(error.message || 'Could not load profile');
        return;
      }
      if (!row) return;

      const p = row as Record<string, unknown>;
      const rawParty = String(p.party ?? '').trim();
      const partyCanon = normalizePartyId(rawParty, parties) || rawParty;
      const avatarUrl = String(p.avatar_url ?? '').trim();

      const next: ProfileFormData = {
        language: String(p.language ?? '').trim(),
        name: String(p.name ?? '').trim(),
        phone: String(p.phone ?? p.phone_number ?? '').trim(),
        email: String(p.email ?? '').trim(),
        designation1: String(p.designation1 ?? p.designation ?? '').trim(),
        designation2: String(p.designation2 ?? p.designation_2 ?? '').trim(),
        designation3: String(p.designation3 ?? p.designation_3 ?? '').trim(),
        designation4: String(p.designation4 ?? p.designation_4 ?? '').trim(),
        avatar_url: avatarUrl,
        partyName: partyCanon,
        state: String(p.state ?? '').trim(),
        stateId:
          typeof p.state_id === 'number' ? p.state_id : p.state_id != null ? Number(p.state_id) : null,
        loksabha_id: typeof p.loksabha_id === 'number' ? p.loksabha_id : p.loksabha_id != null ? Number(p.loksabha_id) : null,
        assembly_id: typeof p.assembly_id === 'number' ? p.assembly_id : p.assembly_id != null ? Number(p.assembly_id) : null,
        loksabha: String(p.loksabha ?? '').trim(),
        assembly: String(p.assembly ?? '').trim(),
        whatsapp: String(p.whatsapp ?? '').trim(),
        facebook: String(p.facebook ?? '').trim(),
        twitter: String(p.twitter ?? '').trim(),
        instagram: String(p.instagram ?? '').trim(),
      };

      if (Number.isNaN(next.loksabha_id as number)) next.loksabha_id = null;
      if (Number.isNaN(next.assembly_id as number)) next.assembly_id = null;

      const { stateId: _omitStateId, ...userPayload } = next;
      setFormData((prev) => ({ ...prev, ...next }));
      setUserInfo((prev) => ({ ...prev, ...userPayload }));
      setFetchUiError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isVisible, setUserInfo]);

  useEffect(() => {
    if (formData.stateId == null) {
      setAvailableLoksabhas([]);
      return;
    }
    let cancelled = false;
    const reqId = ++loksabhaReqIdRef.current;
    const fetchLoksabhas = async () => {
      const { data, error } = await supabase.from('loksabha').select('*').eq('state_id', formData.stateId!);
      if (cancelled || reqId !== loksabhaReqIdRef.current) return;
      if (error) {
        if (__DEV__) console.warn('[EditProfile] fetchLoksabhas error:', error.message);
        setAvailableLoksabhas([]);
        setFetchUiError(error.message || 'Could not load Lok Sabha list');
        return;
      }
      const mapped: GeoItem[] = [];
      for (const row of data ?? []) {
        const item = mapGeoRow(row as Record<string, unknown>);
        if (item) mapped.push(item);
      }
      mapped.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableLoksabhas(mapped);
      setFetchUiError(null);
    };
    void fetchLoksabhas();
    return () => {
      cancelled = true;
    };
  }, [formData.stateId]);

  useEffect(() => {
    if (formData.loksabha_id == null) {
      setAvailableAssemblies([]);
      return;
    }
    let cancelled = false;
    const reqId = ++assemblyReqIdRef.current;
    const fetchAssemblies = async () => {
      const { data, error } = await supabase.from('assembly').select('*').eq('loksabha_id', formData.loksabha_id!);
      if (cancelled || reqId !== assemblyReqIdRef.current) return;
      if (error) {
        if (__DEV__) console.warn('[EditProfile] fetchAssemblies error:', error.message);
        setAvailableAssemblies([]);
        setFetchUiError(error.message || 'Could not load assembly list');
        return;
      }
      const mapped: GeoItem[] = [];
      for (const row of data ?? []) {
        const item = mapGeoRow(row as Record<string, unknown>);
        if (item) mapped.push(item);
      }
      mapped.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableAssemblies(mapped);
      setFetchUiError(null);
    };
    void fetchAssemblies();
    return () => {
      cancelled = true;
    };
  }, [formData.loksabha_id]);

  const selectedState = useMemo(
    () => availableStates.find((s) => Number(s.id) === Number(formData.stateId)),
    [availableStates, formData.stateId]
  );
  const selectedLoksabha = useMemo(
    () => availableLoksabhas.find((l) => Number(l.id) === Number(formData.loksabha_id)),
    [availableLoksabhas, formData.loksabha_id]
  );
  const selectedAssembly = useMemo(
    () => availableAssemblies.find((a) => Number(a.id) === Number(formData.assembly_id)),
    [availableAssemblies, formData.assembly_id]
  );

  const filterGeo = (items: GeoItem[]) => {
    if (!geoSearch.trim()) return items;
    const q = geoSearch.trim().toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q));
  };

  const uploadAvatar = async (localUri: string): Promise<string> => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      throw new Error('Not signed in');
    }
    const publicUrl = await uploadImage(localUri, uid);
    const { error: avatarUpdateError } = await supabase
      .from('profiles')
      .upsert({ id: uid, avatar_url: publicUrl }, { onConflict: 'id' });
    if (avatarUpdateError) {
      if (__DEV__) console.warn('[EditProfile] avatar DB update failed:', avatarUpdateError);
    }
    return publicUrl;
  };

  const pickImage = async () => {
    if (isUploadingAvatar) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('', 'Media permission is required to select a profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const localUri = asset.uri;
    setIsUploadingAvatar(true);
    try {
      const publicUrl = await uploadAvatar(localUri);
      setFormData((prev) => ({ ...prev, avatar_url: publicUrl }));
      setUserInfo((prev) => ({ ...prev, avatar_url: publicUrl }));
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      if (__DEV__) console.warn('[EditProfile] avatar upload failed', e);
      Alert.alert('', msg);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const validateMandatoryFields = (): boolean => {
    const nameOk = (formData.name ?? '').trim().length > 0;
    const mobileOk = (formData.phone ?? '').trim().length > 0;
    const stateOk = (formData.state ?? '').trim().length > 0 || formData.stateId != null;
    if (!nameOk || !mobileOk || !stateOk) {
      Alert.alert('', t('mandatory_fields_alert'));
      return false;
    }
    return true;
  };

  const handleUpdate = async () => {
    if (isUploadingAvatar || isSavingProfile) return;
    if (!validateMandatoryFields()) return;
    setIsSavingProfile(true);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      if (!authUser?.user?.id) {
        Alert.alert('', 'Not signed in');
        return;
      }
      const uid = authUser.user.id;
      const resolvedAvatarUrl = formData.avatar_url;

      const payload: Record<string, unknown> = {
        id: uid,
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        party: formData.partyName,
        designation1: (formData.designation1 ?? '').trim(),
        designation2: (formData.designation2 ?? '').trim(),
        designation3: (formData.designation3 ?? '').trim(),
        designation4: (formData.designation4 ?? '').trim(),
        state: (formData.state ?? '').trim(),
        state_id: formData.stateId == null ? null : Number(formData.stateId),
        loksabha_id: formData.loksabha_id,
        loksabha: (selectedLoksabha?.name ?? formData.loksabha ?? '').trim(),
        assembly_id: formData.assembly_id,
        assembly: (selectedAssembly?.name ?? formData.assembly ?? '').trim(),
        avatar_url: resolvedAvatarUrl || null,
        whatsapp: (formData.whatsapp ?? '').trim(),
        facebook: (formData.facebook ?? '').trim(),
        instagram: (formData.instagram ?? '').trim(),
        twitter: (formData.twitter ?? '').trim(),
      };
      console.log('[gfx] Saving to Supabase:', { state_id: formData.stateId, uid });
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
      if (error) {
        if (__DEV__) console.warn('Profile save failed', error.message, error);
        Alert.alert('', error.message ?? 'Could not save profile');
        return;
      }
      setFormData((prev) => ({ ...prev, avatar_url: resolvedAvatarUrl }));
      try {
        const { stateId: _sid, ...userOnly } = formData;
        setUserInfo({
          ...userOnly,
          state_id: formData.stateId == null ? null : Number(formData.stateId),
          avatar_url: resolvedAvatarUrl,
        });
      } catch (syncErr) {
        if (__DEV__) console.warn('[EditProfile] setUserInfo after save failed:', syncErr);
        Alert.alert('', 'Profile saved but could not update app state');
        return;
      }
      onSaved?.();
      await AsyncStorage.setItem(PROFILE_REDIRECT_DONE_KEY, 'true');
      if (embedMode) {
        return;
      }
      const goAfterSave = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/dashboard');
      };
      Alert.alert(t('profile_updated_title'), t('profile_updated_message'), [{ text: 'OK', onPress: goAfterSave }]);
    } catch (e) {
      if (__DEV__) console.warn('Profile save exception', e);
      Alert.alert('', 'Could not save profile');
    } finally {
      setIsSavingProfile(false);
    }
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
        {embedMode ? (
          <View style={styles.backCircle} />
        ) : (
          <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>{t('edit_profile')}</Text>
        <TouchableOpacity onPress={handleUpdate} disabled={isUploadingAvatar || isSavingProfile}>
          <Text style={[styles.saveHeaderBtn, (isUploadingAvatar || isSavingProfile) && { opacity: 0.45 }]}>
            {isSavingProfile ? 'Saving...' : t('save')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>{t('photo_manager')}</Text></View>
        <View style={styles.imageSection}>
          <View style={styles.previewBox}>
            {formData.avatar_url ? (
              <ExpoImage
                source={{ uri: formData.avatar_url }}
                style={styles.previewImage}
                contentFit="cover"
                cachePolicy="disk"
              />
            ) : (
              <Ionicons name="person" size={40} color="#CCC" />
            )}
            {isUploadingAvatar ? (
              <View style={styles.avatarUploadingOverlay} pointerEvents="auto">
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.updateImageBtn, isUploadingAvatar && styles.updateImageBtnDisabled]}
            onPress={() => void pickImage()}
            disabled={isUploadingAvatar}
            activeOpacity={0.8}
          >
            <Text style={styles.updateImageBtnText}>Update Profile Picture</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          {fetchUiError ? <Text style={styles.fetchErrorText}>{fetchUiError}</Text> : null}
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
                {selectedParty ? selectedParty.fullName : t('party_name')}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </View>
          </TouchableOpacity>

          {renderInput(t('designation_1'), 'designation1', 'ribbon-outline')}
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

        <TouchableOpacity style={[styles.updateBtn, (isUploadingAvatar || isSavingProfile) && { opacity: 0.7 }]} onPress={handleUpdate} disabled={isUploadingAvatar || isSavingProfile}>
          <Text style={styles.updateBtnText}>{isSavingProfile ? 'Saving...' : t('save_all_changes')}</Text>
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
              {filteredParties.map((party: any) => {
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
                    {isPartyOtherId(party.id, parties) ? (
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
              {statesLoading ? (
                <View style={styles.pickerLoading}>
                  <ActivityIndicator size="large" color={Colors.accent} />
                  <Text style={styles.pickerLoadingText}>Loading states…</Text>
                </View>
              ) : null}
              {!statesLoading &&
                filterGeo(availableStates).map((s) => {
                const isSelected = Number(formData.stateId) === Number(s.id);
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setFormData({
                        ...formData,
                        state: s.name,
                        stateId: s.id,
                        loksabha_id: null,
                        assembly_id: null,
                        loksabha: '',
                        assembly: '',
                      });
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
              {!statesLoading && filterGeo(availableStates).length === 0 ? (
                <Text style={styles.pickerEmptyText}>No states found.</Text>
              ) : null}
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
                const isSelected = Number(formData.loksabha_id) === Number(l.id);
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setFormData({ ...formData, loksabha_id: l.id, loksabha: l.name, assembly_id: null, assembly: '' });
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
              {filterGeo(availableLoksabhas).length === 0 ? (
                <Text style={styles.pickerEmptyText}>No Lok Sabha options.</Text>
              ) : null}
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
                const isSelected = Number(formData.assembly_id) === Number(a.id);
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setFormData({ ...formData, assembly_id: a.id, assembly: a.name });
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
              {filterGeo(availableAssemblies).length === 0 ? (
                <Text style={styles.pickerEmptyText}>No assembly options.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function EditProfilePage() {
  return <EditProfileScreen />;
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
  previewBox: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EEE',
    overflow: 'hidden',
    position: 'relative',
  },
  previewImage: { width: '100%', height: '100%' },
  avatarUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 15,
    elevation: 9,
  },
  updateImageBtn: {
    marginTop: 14,
    width: 220,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  updateImageBtnDisabled: { opacity: 0.7 },
  updateImageBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  form: { paddingHorizontal: 20 },
  fetchErrorText: { marginTop: 8, marginBottom: 4, color: Colors.error, fontSize: 13, fontWeight: '600' },
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
  pickerLoading: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  pickerLoadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  pickerEmptyText: { paddingVertical: 24, textAlign: 'center', fontSize: 14, color: '#888' },
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
