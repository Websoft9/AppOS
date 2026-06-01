import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Import translation resources directly (bundled)
import storeEn from '../locales/en/store.json'
import storeZh from '../locales/zh/store.json'
import commonEn from '../locales/en/common.json'
import commonZh from '../locales/zh/common.json'
import aiChatEn from '../locales/en/aiChat.json'
import aiChatZh from '../locales/zh/aiChat.json'
import resourcesEn from '../locales/en/resources.json'
import resourcesZh from '../locales/zh/resources.json'
import navigationEn from '../locales/en/navigation.json'
import navigationZh from '../locales/zh/navigation.json'

const resources = {
  en: {
    store: storeEn,
    common: commonEn,
    aiChat: aiChatEn,
    resources: resourcesEn,
    navigation: navigationEn,
  },
  zh: {
    store: storeZh,
    common: commonZh,
    aiChat: aiChatZh,
    resources: resourcesZh,
    navigation: navigationZh,
  },
}

// App Store defaults to English; respect explicit user selection
const savedLang = localStorage.getItem('ws9-locale')
const defaultLang = savedLang ?? 'en'

i18n.use(initReactI18next).init({
  resources,
  lng: defaultLang,
  fallbackLng: 'en',
  ns: ['common', 'store', 'aiChat', 'resources', 'navigation'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n

export function setLocale(lang: 'en' | 'zh') {
  localStorage.setItem('ws9-locale', lang)
  i18n.changeLanguage(lang)
}

export function getLocale(): 'en' | 'zh' {
  const lang = i18n.language
  return lang.startsWith('zh') ? 'zh' : 'en'
}
