import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Platform, StatusBar, StyleSheet, Text, View } from 'react-native';

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    // 3 second ka timer taaki user logo dekh sake
    const timer = setTimeout(() => {
      // Ab hum login ke bajaye seedha language selection par bhej rahe hain
      router.replace('/language');
    }, 3000);
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />
      
      <View style={styles.content}>
        {/* Logo Placeholder */}
        <View style={styles.logoPlaceholder}>
          <Text style={styles.logoText}>S</Text>
        </View>
        
        <Text style={styles.brandName}>SOCIAL POST</Text>
        <Text style={styles.tagline}>Political Advocacy Platform</Text>
        
        <View style={styles.loaderContainer}>
          <Text style={styles.loadingText}>Initializing...</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FCAC12', // Aapka Brand Color
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...Platform.select({
      web: { boxShadow: '0px 4px 10px rgba(0,0,0,0.1)' },
      android: { elevation: 5 }
    })
  },
  logoText: {
    fontSize: 50,
    fontWeight: 'bold',
    color: '#FCAC12',
  },
  brandName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 5,
    fontWeight: '500',
  },
  loaderContainer: {
    marginTop: 40,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 12,
    opacity: 0.7,
  }
});