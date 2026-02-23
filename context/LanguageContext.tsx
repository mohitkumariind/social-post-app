import React, { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../utils/i18n'; // i18n configuration import kiya

interface LanguageContextType {
  t: (key: string) => string;
  changeLanguage: (lng: string) => void;
  lang: string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState(i18n.language);

  const changeLanguage = (lng: string) => {
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