import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ 
      headerShown: false,
      tabBarActiveTintColor: '#8A2BE2',
      tabBarInactiveTintColor: '#666',
    }}>
      {/* 1. Dashboard Tab */}
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={24} color={color} />,
        }}
      />

      {/* 2. Profile Tab */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={24} color={color} />,
        }}
      />

      {/* 3. Edit Profile (Ise TAB se HIDE karna hai) */}
      <Tabs.Screen
        name="edit-profile"
        options={{
          href: null, // Ye line ise bottom bar se chhupa degi par screen kaam karegi
          tabBarStyle: { display: 'none' }, // Edit profile khule toh tab bar na dikhe
        }}
      />
    </Tabs>
  );
}