import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLang } from '../../context/LanguageContext';

/** Web fallback - post detail uses native-only libs (ViewShot, etc). */
export default function PostDetailWeb() {
  const router = useRouter();
  const { t } = useLang();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('ready_to_post') || 'Ready to Post'}</Text>
      <Text style={styles.message}>
        Poster creation with frames is available on the mobile app.
      </Text>
      <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
        <Text style={styles.btnText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  message: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  btn: { backgroundColor: '#8A2BE2', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#FFF', fontWeight: '600' },
});
