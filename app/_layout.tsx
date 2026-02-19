import { Stack } from 'expo-router';
import { UserProvider } from '../context/UserContext';

export default function RootLayout() {
  return (
    <UserProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)/dashboard" />
        <Stack.Screen name="editor" /> {/* YE LINE ADD KARDI */}
        <Stack.Screen name="(auth)/profile" />
        <Stack.Screen name="(auth)/edit-profile" />
        <Stack.Screen name="(auth)/post-detail" />
      </Stack>
    </UserProvider>
  );
}