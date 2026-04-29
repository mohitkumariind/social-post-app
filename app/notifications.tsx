import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/Colors';
import { useLang } from '../context/LanguageContext';

type NotiItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  isUnread: boolean;
  type: 'post' | 'reward' | 'video';
};

export default function NotificationScreen() {
  const router = useRouter();
  const { t } = useLang();
  const [notifications, setNotifications] = useState<NotiItem[]>([]);

  const markAllRead = () => {
    const updated = notifications.map(n => ({ ...n, isUnread: false }));
    setNotifications(updated);
  };

  const renderItem = ({ item }: { item: NotiItem }) => (
    <TouchableOpacity style={[styles.notiCard, item.isUnread && styles.unreadCard]}>
      <View style={[styles.iconBox, { backgroundColor: item.type === 'post' ? Colors.successBg : '#FFF3E0' }]}>
        <Ionicons 
          name={item.type === 'post' ? "image-outline" : item.type === 'reward' ? "gift-outline" : "videocam-outline"} 
          size={22} 
          color={item.type === 'post' ? "#2ECC71" : "#FF9800"} 
        />
      </View>
      
      <View style={styles.textContainer}>
        <View style={styles.row}>
          <Text style={styles.notiTitle}>{item.title}</Text>
          {item.isUnread && <View style={styles.dot} />}
        </View>
        <Text style={styles.notiMessage} numberOfLines={2}>{item.message}</Text>
        <Text style={styles.notiTime}>{item.time}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('notifications')}</Text>
        <TouchableOpacity onPress={markAllRead}>
          <Text style={styles.markReadText}>{t('mark_all_read')}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 20 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyStateWrap}>
            <Ionicons name="notifications-off-outline" size={38} color={Colors.textMuted} />
            <Text style={styles.emptyStateText}>No notifications yet.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingVertical: 15, 
    backgroundColor: '#FFF',
    marginTop: Platform.OS === 'android' ? 30 : 0
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  markReadText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  
  notiCard: { 
    flexDirection: 'row', 
    backgroundColor: '#FFF', 
    padding: 15, 
    borderRadius: 16, 
    marginBottom: 12,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5
  },
  unreadCard: { borderLeftWidth: 4, borderLeftColor: Colors.accent },
  iconBox: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  textContainer: { flex: 1, marginLeft: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notiTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  notiMessage: { fontSize: 13, color: '#666', marginTop: 3, lineHeight: 18 },
  notiTime: { fontSize: 11, color: '#AAA', marginTop: 8, fontWeight: '500' },
  
  emptyStateWrap: { paddingTop: 40, alignItems: 'center', justifyContent: 'center' },
  emptyStateText: { marginTop: 10, fontSize: 14, color: Colors.textMuted, fontWeight: '600' },
});