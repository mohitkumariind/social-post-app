import { Colors } from '../constants/Colors';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StatusBar, StyleSheet, Text, View } from 'react-native';

export default function SplashScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [dots, setDots] = useState('.');

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev === '.' ? '..' : prev === '..' ? '...' : '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/language');
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      <StatusBar hidden={true} />
      <View style={styles.content}>
        <Animated.View style={[styles.logoWrapper, { opacity: fadeAnim }]}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>
        <Animated.Text style={[styles.tagline, { opacity: fadeAnim }]} numberOfLines={1}>
          Connecting Leaders  {'\u2022'}  Connecting People
        </Animated.Text>
        <View style={styles.initializingRow}>
          <Text style={styles.initializingText}>Initializing{dots}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  logoWrapper: {
    width: 360,
    height: 360,
    marginBottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  logo: {
    width: 360,
    height: 360,
  },
  tagline: {
    color: '#262626',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: Colors.fontFamilyBold,
    letterSpacing: 0.3,
    textAlign: 'center',
    marginTop: -50,
    marginBottom: 32,
    zIndex: 10,
  },
  initializingRow: {
    paddingTop: 16,
  },
  initializingText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: Colors.fontFamily,
  },
});
