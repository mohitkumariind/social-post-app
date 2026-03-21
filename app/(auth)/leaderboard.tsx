import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Dimensions, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';
import { useLang } from '../../context/LanguageContext';

const { width } = Dimensions.get('window');

export default function LeaderboardScreen() {
  const router = useRouter();
  const { t } = useLang();

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.headerGradient, { backgroundColor: Colors.primary }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('leaderboard')}</Text>
          <View style={{ width: 40 }} />
        </View>
      </View>

      <View style={styles.emptyWrap}>
        <Ionicons name="trophy-outline" size={72} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>{t('coming_soon_title')}</Text>
        <Text style={styles.emptySub}>{t('coming_soon_sub')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerGradient: {
    paddingTop: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF' },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: width,
  },
  emptyTitle: {
    marginTop: 20,
    fontSize: 20,
    fontWeight: '800',
    color: Colors.headerColor,
    textAlign: 'center',
  },
  emptySub: {
    marginTop: 10,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
