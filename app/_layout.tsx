import { Stack } from 'expo-router';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { UserProvider } from '../context/UserContext';
import i18nInstance from '../utils/i18n';

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18nInstance}>
      <UserProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="language" />
          <Stack.Screen name="party" />
          <Stack.Screen name="(auth)/login" />
          <Stack.Screen name="(auth)/dashboard" />
          <Stack.Screen name="editor" />
          <Stack.Screen name="(auth)/profile" />
          <Stack.Screen name="(auth)/edit-profile" />
          <Stack.Screen name="(auth)/post-detail" />
        </Stack>
      </UserProvider>
    </I18nextProvider>
  );
}