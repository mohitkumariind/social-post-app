import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useLang } from '../../context/LanguageContext';

export default function TabsLayout() {
  const { t } = useLang();

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#8A2BE2',
      tabBarInactiveTintColor: '#666',
      tabBarStyle: {
        height: 60,
        paddingBottom: 10,
        paddingTop: 5,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#EEE',
      }
    }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('tab_home') || 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: t('tab_profile') || 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
