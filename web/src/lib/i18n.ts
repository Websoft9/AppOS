import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'

type Locale = 'en' | 'zh'
type Namespace = 'common' | 'store' | 'aiChat' | 'resources' | 'navigation'

type ResourceModule = {
  default: Record<string, unknown>
}

type LocaleResources = Record<Namespace, Record<string, unknown>>

const NAMESPACES: Namespace[] = ['common', 'store', 'aiChat', 'resources', 'navigation']

const i18n = createInstance()

const localeLoaders: Record<Locale, Record<Namespace, () => Promise<ResourceModule>>> = {
  en: {
    common: () => import('../locales/en/common.json'),
    store: () => import('../locales/en/store.json'),
    aiChat: () => import('../locales/en/aiChat.json'),
    resources: () => import('../locales/en/resources.json'),
    navigation: () => import('../locales/en/navigation.json'),
  },
  zh: {
    common: () => import('../locales/zh/common.json'),
    store: () => import('../locales/zh/store.json'),
    aiChat: () => import('../locales/zh/aiChat.json'),
    resources: () => import('../locales/zh/resources.json'),
    navigation: () => import('../locales/zh/navigation.json'),
  },
}

const resourceStore: Partial<Record<Locale, LocaleResources>> = {}
const loadedLocales = new Set<Locale>()

function buildInitOptions(lang: Locale) {
  return {
    resources: resourceStore,
    lng: lang,
    fallbackLng: 'en' as const,
    ns: NAMESPACES,
    defaultNS: 'common' as const,
    interpolation: {
      escapeValue: false,
    },
  }
}

function readSavedLocale(): Locale {
  const savedLang = globalThis.localStorage?.getItem('ws9-locale')
  return savedLang === 'zh' ? 'zh' : 'en'
}

async function ensureLocaleResources(lang: Locale) {
  if (loadedLocales.has(lang)) return

  const entries = await Promise.all(
    NAMESPACES.map(async namespace => {
      const module = await localeLoaders[lang][namespace]()
      return [namespace, module.default] as const
    })
  )

  resourceStore[lang] = Object.fromEntries(entries) as LocaleResources

  loadedLocales.add(lang)
}

async function initializeI18n() {
  const defaultLang = readSavedLocale()
  const fallbackLang: Locale = 'en'

  await Promise.all([
    ensureLocaleResources(defaultLang),
    defaultLang === fallbackLang ? Promise.resolve() : ensureLocaleResources(fallbackLang),
  ])

  await i18n.use(initReactI18next).init(buildInitOptions(defaultLang))
}

export const i18nReady = initializeI18n()
await i18nReady

export default i18n

export async function setLocale(lang: Locale) {
  localStorage.setItem('ws9-locale', lang)
  await ensureLocaleResources(lang)
  await i18n.init(buildInitOptions(lang))
}

export function getLocale(): Locale {
  const lang = i18n.language
  return lang.startsWith('zh') ? 'zh' : 'en'
}
