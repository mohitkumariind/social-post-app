import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useUser } from '../context/UserContext';

export default function EditProfileScreen() {
  const router = useRouter();
  const { userInfo, setUserInfo } = useUser();
  const [formData, setFormData] = useState({ ...userInfo });

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
    Alert.alert('Success', 'Profile Updated! ✅');
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
          <Ionicons name="chevron-back" size={20} color="#666" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleUpdate}><Text style={styles.saveHeaderBtn}>Save</Text></TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        
        {/* Photo Manager */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>PHOTO MANAGER</Text></View>
        <View style={styles.imageSection}>
          <View style={styles.imageRow}>
            {[0, 1, 2].map((i) => (
              <TouchableOpacity key={i} style={[styles.imgCircle, formData.activePhotoIndex === i && styles.activeImg]} onPress={() => setFormData({...formData, activePhotoIndex: i})}>
                {formData.profilePics[i] ? <Image source={{ uri: formData.profilePics[i] }} style={styles.img} /> : <Ionicons name="add" size={28} color="#CCC" />}
                <TouchableOpacity style={styles.pencil} onPress={() => pickImage(i)}><Ionicons name="pencil" size={10} color="#333" /></TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hintText}>Tap on a photo to select for posters</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formHead}>PERSONAL INFO</Text>
          {renderInput('Full Name', 'name', 'person-outline')}
          {renderInput('Mobile', 'phone', 'call-outline')}
          {renderInput('Email', 'email', 'mail-outline')}

          <Text style={styles.formHead}>POLITICAL PROFILE</Text>
          {renderInput('Party Name', 'partyName', 'flag-outline')}
          {renderInput('Designation 1', 'designation', 'ribbon-outline')}
          {renderInput('Designation 2', 'designation2', 'ribbon-outline')}
          {renderInput('Designation 3', 'designation3', 'ribbon-outline')}
          {renderInput('Designation 4', 'designation4', 'ribbon-outline')}
          {renderInput('State', 'state', 'location-outline')}
          {renderInput('District', 'district', 'business-outline')}
          {renderInput('Assembly', 'assembly', 'map-outline')}

          <Text style={styles.formHead}>SOCIAL LINKS</Text>
          {renderInput('WhatsApp', 'whatsapp', 'logo-whatsapp')}
          {renderInput('Facebook', 'facebook', 'logo-facebook')}
          {renderInput('Instagram', 'instagram', 'logo-instagram')}
          {renderInput('Twitter (X)', 'twitter', 'logo-twitter')}
        </View>

        <TouchableOpacity style={styles.updateBtn} onPress={handleUpdate}>
          <Text style={styles.updateBtnText}>Save All Changes</Text>
        </TouchableOpacity>
      </ScrollView>
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
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  labelPart: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  inputLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  textInput: { flex: 1.5, fontSize: 14, fontWeight: '600', color: '#333' },
  updateBtn: { backgroundColor: '#2ECC71', margin: 25, height: 55, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginTop: 40 },
  updateBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' }
});