import { Stack } from 'expo-router';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider } from '../context/LanguageContext';
import { UserProvider } from '../context/UserContext';
import i18n from '../utils/i18n';

export default function RootLayout() {
  return (
    // 1. Sabse pehle Translation Provider
    <I18nextProvider i18n={i18n}>
      
      {/* 2. LanguageProvider: Jo aapki bhasha ka state handle karega */}
      <LanguageProvider>
        
        {/* 3. UserProvider: Jo login/user data handle karega */}
        <UserProvider>
          
          <Stack screenOptions={{ headerShown: false }}>
            {/* Root Screens */}
            <Stack.Screen name="index" />
            <Stack.Screen name="language" />
            
            {/* Auth (login, post-detail, terms, etc.) and Tabs (dashboard, profile) */}
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          
        </UserProvider>
      </LanguageProvider>
    </I18nextProvider>
  );
}