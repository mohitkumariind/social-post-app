import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    FlatList, // Sahi Component ye hai
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

// Dummy Data
const NOTIFICATIONS_DATA = [
  {
    id: '1',
    title: 'Naya Poster Aaya! 🚩',
    message: 'Mahashivratri ke liye naye frames live ho gaye hain. Abhi apna poster banayein!',
    time: '2 mins ago',
    isUnread: true,
    type: 'post'
  },
  {
    id: '2',
    title: 'Referral Bonus! 💰',
    message: 'Aapke dost ne join kiya! Aapko 50 points mil gaye hain.',
    time: '1 hour ago',
    isUnread: true,
    type: 'reward'
  },
  {
    id: '3',
    title: 'Trending Video 🎥',
    message: 'Aaj ka trending political video dekhein aur share karein.',
    time: 'Yesterday',
    isUnread: false,
    type: 'video'
  },
];

export default function NotificationScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState(NOTIFICATIONS_DATA);

  const markAllRead = () => {
    const updated = notifications.map(n => ({ ...n, isUnread: false }));
    setNotifications(updated);
  };

  const renderItem = ({ item }: { item: typeof NOTIFICATIONS_DATA[0] }) => (
    <TouchableOpacity style={[styles.notiCard, item.isUnread && styles.unreadCard]}>
      <View style={[styles.iconBox, { backgroundColor: item.type === 'post' ? '#E8F5E9' : '#FFF3E0' }]}>
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
          <Ionicons name="chevron-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={markAllRead}>
          <Text style={styles.markReadText}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      {notifications.length > 0 ? (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 20 }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="notifications-off-outline" size={80} color="#CCC" />
          <Text style={styles.emptyTitle}>No Notifications Yet</Text>
          <Text style={styles.emptySub}>Hum aapko updates yahan bhejenge.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
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
  markReadText: { color: '#8A2BE2', fontWeight: '700', fontSize: 13 },
  
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
  unreadCard: { borderLeftWidth: 4, borderLeftColor: '#8A2BE2' },
  iconBox: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  textContainer: { flex: 1, marginLeft: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notiTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#8A2BE2' },
  notiMessage: { fontSize: 13, color: '#666', marginTop: 3, lineHeight: 18 },
  notiTime: { fontSize: 11, color: '#AAA', marginTop: 8, fontWeight: '500' },
  
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 100 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#333', marginTop: 20 },
  emptySub: { fontSize: 14, color: '#999', marginTop: 5 }
});