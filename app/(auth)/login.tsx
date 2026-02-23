import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Image, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';

// Path Fixed: root/context tak pahunchne ke liye do baar piche (../../)
import { useLang } from '../../context/LanguageContext';

export default function LoginScreen() {
  const router = useRouter(); 
  const { t } = useLang(); 

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.inner}>
          
          {/* Logo Section */}
          <View style={styles.logoContainer}>
            <Image 
              // Logo path bhi root assets folder ke hisab se set kiya hai
              source={require('../../assets/images/splash-logo.png')} 
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>{t('login_title')}</Text>
            <Text style={styles.subtitle}>{t('login_subtitle')}</Text>
          </View>

          {/* Social Buttons Section */}
          <View style={styles.buttonWrapper}>
            
            {/* Google Login */}
            <TouchableOpacity 
              style={[styles.socialBtn, { backgroundColor: '#FFFFFF', borderColor: '#EEE', borderWidth: 1 }]}
              onPress={() => router.replace('/dashboard')} 
            >
              <Ionicons name="logo-google" size={24} color="#DB4437" />
              <Text style={[styles.socialBtnText, { color: '#555' }]}>
                {t('continue_google')}
              </Text>
            </TouchableOpacity>

            {/* Facebook Login */}
            <TouchableOpacity 
              style={[styles.socialBtn, { backgroundColor: '#1877F2' }]}
              onPress={() => router.replace('/dashboard')}
            >
              <Ionicons name="logo-facebook" size={24} color="white" />
              <Text style={styles.socialBtnText}>
                {t('continue_facebook')}
              </Text>
            </TouchableOpacity>

            {/* Twitter (X) Login */}
            <TouchableOpacity 
              style={[styles.socialBtn, { backgroundColor: '#000000' }]}
              onPress={() => router.replace('/dashboard')}
            >
              <Ionicons name="logo-twitter" size={24} color="white" />
              <Text style={styles.socialBtnText}>
                {t('continue_twitter')}
              </Text>
            </TouchableOpacity>

          </View>

          {/* Footer Info */}
          <View style={styles.footer}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#4CAF50" />
            <Text style={styles.footerText}> 
              {t('secure_login')}
            </Text>
          </View>

        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center' },
  inner: { padding: 30, alignItems: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: 50 },
  logo: { width: 120, height: 120 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#1A1A1A', marginTop: 10 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
  buttonWrapper: { width: '100%', gap: 15 },
  socialBtn: { 
    flexDirection: 'row',
    height: 60, 
    borderRadius: 15, 
    justifyContent: 'center', 
    alignItems: 'center', 
    width: '100%',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  socialBtnText: { 
    color: '#FFF', 
    fontSize: 16, 
    fontWeight: '600', 
    marginLeft: 15 
  },
  footer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginTop: 50,
    backgroundColor: '#F0F9F0',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20
  },
  footerText: { color: '#4CAF50', fontSize: 13, fontWeight: '500' }
});