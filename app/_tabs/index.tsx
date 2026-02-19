import { StyleSheet, Text, View } from 'react-native';

export default function TabHomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Social Post Dashboard</Text>
      <Text style={styles.subtitle}>Ready for SocialBot Integration</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1A1A1A' },
  subtitle: { fontSize: 16, color: '#666', marginTop: 10 }
});