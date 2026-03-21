import { Stack } from 'expo-router';
import React from 'react';

export default function TabsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}
