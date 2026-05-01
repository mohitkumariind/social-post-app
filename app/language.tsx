import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { Colors } from '../constants/Colors';
import { useLang } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';
import '../utils/i18n';

const languages = [
  { id: 'en', label: 'English', sub: 'Global Language' },
  { id: 'hi', label: 'हिंदी', sub: 'राष्ट्रीय भाषा' },
  { id: 'pa', label: 'ਪੰਜਾਬੀ', sub: 'ਖੇਤਰੀ ਭਾਸ਼ਾ' },
  { id: 'mr', label: 'मराठी', sub: 'प्रादेशिक भाषा' },
  { id: 'gu', label: 'ગુજરાતી', sub: 'પ્રાદેશિક ભાષા' },
];

export default function LanguageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t, changeLanguage, lang } = useLang();
  const { setUserInfo } = useUser();
  const [selectedLang, setSelectedLang] = useState(lang || 'en');
  const [isSaving, setIsSaving] = useState(false);
  const [safeTitle, setSafeTitle] = useState('Choose Language');
  const [safeSubtitle, setSafeSubtitle] = useState('Select your preferred language');
  const [safeContinue, setSafeContinue] = useState('Continue');
  const isMountedRef = useRef(true);

  useEffect(() => {
    setSelectedLang(lang || 'en');
  }, [lang]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const title = String(t('choose_lang') ?? '').trim();
    const subtitle = String(t('sub_lang') ?? '').trim();
    const cont = String(t('continue') ?? '').trim();
    setSafeTitle(title || 'Choose Language');
    setSafeSubtitle(subtitle || 'Select your preferred language');
    setSafeContinue(cont || 'Continue');
  }, [lang, t]);

  const handleConfirm = async () => {
    if (!selectedLang || isSaving) return;
    setIsSaving(true);
    try {
      await changeLanguage(selectedLang);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { error } = await supabase
          .from('profiles')
          .update({ language: selectedLang })
          .eq('id', session.user.id);
        if (error && __DEV__) console.warn('[Language] profiles.language save:', error.message);
      }
      setUserInfo((prev) => ({ ...prev, language: selectedLang }));
      const next =
        typeof params.next === 'string'
          ? params.next
          : Array.isArray(params.next)
            ? params.next[0]
            : undefined;

      const navigateTo = async (to: string) => {
        await Promise.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        router.replace(to);
      };

      if (next) {
        if (next === '/dashboard') {
          await navigateTo('/(tabs)/dashboard');
        } else {
          await navigateTo(next);
        }
        return;
      }
      // Bina `next` ke (purana flow): logged-in user ko login par mat bhejo — loop fix
      if (session?.user) {
        await navigateTo('/party');
      } else {
        await navigateTo('/(auth)/login');
      }
    } catch (error) {
      if (__DEV__) console.warn('[Language] handleConfirm failed:', error);
      Alert.alert('Language update failed', 'Please try again.');
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header Section */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoLetter}>S</Text>
        </View>
        <Text style={styles.title}>{safeTitle}</Text> 
        <Text style={styles.subtitle}>{safeSubtitle}</Text>
      </View>

      {/* Language List */}
      <ScrollView 
        contentContainerStyle={styles.listContainer} 
        showsVerticalScrollIndicator={false}
      >
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
              <View style={[
                  styles.iconCircle, 
                  selectedLang === item.id && styles.selectedIconCircle
              ]}>
                <Ionicons 
                    name="language-outline" 
                    size={24} 
                    color={selectedLang === item.id ? '#FFF' : Colors.primary} 
                />
              </View>
              <View style={styles.textGroup}>
                <Text style={[
                    styles.label, 
                    selectedLang === item.id && styles.selectedLabel
                ]}>
                    {item.label}
                </Text>
                <Text style={styles.subLabel}>{item.sub}</Text>
              </View>
            </View>
            
            {selectedLang === item.id ? (
              <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
            ) : (
              <View style={styles.emptyCircle} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Footer / Confirm Button */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.chooseBtn, (!selectedLang || isSaving) && styles.disabledBtn]} 
          onPress={handleConfirm} 
          disabled={!selectedLang || isSaving}
        >
          <Text style={styles.chooseBtnText}>{isSaving ? 'Saving...' : safeContinue}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background 
  },
  header: { 
    backgroundColor: Colors.primary, 
    paddingTop: 60, 
    paddingBottom: 30, 
    alignItems: 'center', 
    borderBottomLeftRadius: 30, 
    borderBottomRightRadius: 30 
  },
  logoCircle: { 
    width: 60, 
    height: 60, 
    backgroundColor: '#FFF', 
    borderRadius: 30, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  logoLetter: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    color: Colors.primary 
  },
  title: { 
    fontSize: 26, 
    fontWeight: 'bold', 
    color: '#FFF' 
  },
  subtitle: { 
    fontSize: 14, 
    color: 'rgba(255,255,255,0.9)', 
    marginTop: 5 
  },
  listContainer: { 
    padding: 20, 
    paddingBottom: 110 
  },
  card: { 
    backgroundColor: Colors.cardBg, 
    padding: 20, 
    borderRadius: Colors.borderRadius, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 15, 
    ...Colors.cardShadow,
    elevation: Colors.cardElevation,
  },
  selectedCard: { 
    backgroundColor: 'rgba(142, 36, 170, 0.06)',
  },
  cardContent: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  iconCircle: { 
    width: 48, 
    height: 48, 
    backgroundColor: '#FFF9EF', 
    borderRadius: 14, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 15 
  },
  selectedIconCircle: { 
    backgroundColor: Colors.primary 
  },
  textGroup: { 
    justifyContent: 'center' 
  },
  label: { 
    fontSize: 18, 
    fontWeight: '700', 
    color: '#333' 
  },
  selectedLabel: { 
    color: Colors.primary 
  },
  subLabel: { 
    fontSize: 12, 
    color: '#999', 
    marginTop: 2 
  },
  emptyCircle: { 
    width: 24, 
    height: 24, 
    borderRadius: 12, 
    borderWidth: 2, 
    borderColor: Colors.border 
  },
  footer: { 
    position: 'absolute', 
    bottom: 0, 
    left: 0, 
    right: 0, 
    padding: 20, 
    backgroundColor: '#FFF', 
    borderTopWidth: 1, 
    borderTopColor: Colors.borderLight 
  },
  chooseBtn: { 
    backgroundColor: Colors.primary,
    paddingVertical: 18, 
    borderRadius: 18, 
    alignItems: 'center' 
  },
  disabledBtn: { 
    backgroundColor: Colors.border 
  },
  chooseBtnText: { 
    color: '#FFF', 
    fontSize: 18, 
    fontWeight: 'bold' 
  }
});