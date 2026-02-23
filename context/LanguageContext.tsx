import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../utils/i18n';

const LANG_STORAGE_KEY = '@social_post_language';
const SUPPORTED_LANGS = ['en', 'hi', 'pa', 'mr', 'gu'];

interface LanguageContextType {
  t: (key: string) => string;
  changeLanguage: (lng: string) => void;
  lang: string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState(i18n.language);

  // Restore saved language on app load / refresh
  useEffect(() => {
    AsyncStorage.getItem(LANG_STORAGE_KEY).then((savedLng) => {
      if (savedLng && SUPPORTED_LANGS.includes(savedLng)) {
        i18n.changeLanguage(savedLng);
        setLang(savedLng);
      }
    });
  }, [i18n]);

  const changeLanguage = (lng: string) => {
    if (!SUPPORTED_LANGS.includes(lng)) return;
    AsyncStorage.setItem(LANG_STORAGE_KEY, lng);
    i18n.changeLanguage(lng);
    setLang(lng);
  };

  return (
    <LanguageContext.Provider value={{ t, changeLanguage, lang }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLang = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLang must be used within a LanguageProvider');
  return context;
};