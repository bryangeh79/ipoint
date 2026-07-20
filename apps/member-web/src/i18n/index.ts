import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enTranslations from './locales/en/translation.json';
import zhTranslations from './locales/zh/translation.json';

const SUPPORTED_LOCALES = ['en', 'zh'] as const;

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function detectLocale(): SupportedLocale {
  const browserLangs = navigator.languages ?? [navigator.language];
  for (const raw of browserLangs) {
    const normalized = raw.split('-')[0];
    if (normalized === 'zh') return 'zh';
    if (normalized === 'en') return 'en';
  }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: enTranslations },
    zh: { translation: zhTranslations },
  },
  lng: detectLocale(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
  returnEmptyString: false,
});

export default i18n;
