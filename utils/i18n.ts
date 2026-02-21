import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  resources: {
    en: {
      translation: {
        choose_lang: "Select Language",
        continue: "Continue",
        welcome: "Welcome",
        dashboard: "Dashboard",
        profile: "Profile",
        logout: "Logout",
        select_party: "Select Party"
      }
    },
    hi: {
      translation: {
        choose_lang: "भाषा चुनें",
        continue: "आगे बढ़ें",
        welcome: "स्वागत है",
        dashboard: "डैशबोर्ड",
        profile: "प्रोफ़ाइल",
        logout: "लॉग आउट",
        select_party: "पार्टी चुनें"
      }
    },
    pa: {
      translation: {
        choose_lang: "ਭਾਸ਼ਾ ਚੁਣੋ",
        continue: "ਜਾਰੀ ਰੱਖੋ",
        welcome: "ਜੀ ਆਇਆਂ ਨੂੰ",
        dashboard: "ਡੈਸ਼ਬੋਰਡ",
        profile: "ਪ੍ਰੋਫਾਈਲ",
        logout: "ਲੌਗ ਆਉਟ",
        select_party: "ਪਾਰਟੀ ਚੁਣੋ"
      }
    },
    mr: {
      translation: {
        choose_lang: "भाषा निवडा",
        continue: "पुढे जा",
        welcome: "स्वागत आहे",
        dashboard: "डॅशबोर्ड",
        profile: "प्रोफाइल",
        logout: "लॉग आउट",
        select_party: "पक्ष निवडा"
      }
    },
    gu: {
      translation: {
        choose_lang: "ભાષા પસંદ કરો",
        continue: "આગળ વધો",
        welcome: "સ્વાગત છે",
        dashboard: "ડેશબોર્ડ",
        profile: "પ્રોફાઇલ",
        logout: "લૉગ આઉટ",
        select_party: "પાર્ટી પસંદ કરો"
      }
    }
  },
  lng: 'en', 
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
});

export default i18n;