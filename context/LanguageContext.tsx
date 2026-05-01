import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../utils/i18n';

const LANG_STORAGE_KEY = '@social_post_language';
/** Keep in sync with `languages` ids in `app/language.tsx`. */
export const SUPPORTED_LANGS = ['en', 'hi', 'pa', 'mr', 'gu'] as const;

interface LanguageContextType {
  t: (key: string) => string;
  changeLanguage: (lng: string) => Promise<void>;
  lang: string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, i18n, ready } = useTranslation();
  const [lang, setLang] = useState(i18n.language);

  // Safe t: returns key if i18n not ready or t throws (Expo Go fallback)
  const safeT = (key: string) => {
    try {
      return ready ? t(key) : key;
    } catch {
      return key;
    }
  };

  // Restore saved language on app load / refresh
  useEffect(() => {
    AsyncStorage.getItem(LANG_STORAGE_KEY).then((savedLng) => {
      if (savedLng && (SUPPORTED_LANGS as readonly string[]).includes(savedLng)) {
        i18n.changeLanguage(savedLng);
        setLang(savedLng);
      }
    });
  }, [i18n]);

  const changeLanguage = async (lng: string) => {
    if (!(SUPPORTED_LANGS as readonly string[]).includes(lng)) return;
    try {
      await AsyncStorage.setItem(LANG_STORAGE_KEY, lng);
    } catch {
      // Non-blocking: continue with in-memory language switch.
    }
    try {
      await i18n.changeLanguage(lng);
    } catch {
      // Keep app running even if language resources fail unexpectedly.
    }
    setLang(lng);
  };

  return (
    <LanguageContext.Provider value={{ t: safeT, changeLanguage, lang }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLang = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLang must be used within a LanguageProvider');
  return context;
};