import { createInstance } from 'i18next'
import type { TFunction } from 'i18next'
import { initReactI18next } from 'react-i18next'

type Locale = 'en' | 'zh'
type Namespace =
  | 'common'
  | 'apps'
  | 'deploy'
  | 'docker'
  | 'publish'
  | 'space'
  | 'feeds'
  | 'secrets'
  | 'certificates'
  | 'store'
  | 'aiCopilot'
  | 'aiAgent'
  | 'resources'
  | 'navigation'
  | 'auth'
  | 'topics'
  | 'groups'
  | 'sharedEnvs'
  | 'profile'
  | 'audit'
  | 'connect'
  | 'system'
  | 'superuser'

type ResourceModule = {
  default: Record<string, unknown>
}

type LocaleResources = Record<Namespace, Record<string, unknown>>

const NAMESPACES: Namespace[] = [
  'common',
  'apps',
  'deploy',
  'docker',
  'publish',
  'space',
  'feeds',
  'secrets',
  'certificates',
  'store',
  'aiCopilot',
  'aiAgent',
  'resources',
  'navigation',
  'auth',
  'topics',
  'groups',
  'sharedEnvs',
  'profile',
  'audit',
  'connect',
  'system',
  'superuser',
]

const i18n = createInstance()

const localeLoaders: Record<Locale, Record<Namespace, () => Promise<ResourceModule>>> = {
  en: {
    common: () => import('../locales/en/common.json'),
    apps: () => import('../locales/en/apps.json'),
    deploy: () => import('../locales/en/deploy.json'),
    docker: () => import('../locales/en/docker.json'),
    publish: () => import('../locales/en/publish.json'),
    space: () => import('../locales/en/space.json'),
    feeds: () => import('../locales/en/feeds.json'),
    secrets: () => import('../locales/en/secrets.json'),
    certificates: () => import('../locales/en/certificates.json'),
    store: () => import('../locales/en/store.json'),
    aiCopilot: () => import('../locales/en/aiCopilot.json'),
    aiAgent: () => import('../locales/en/aiAgent.json'),
    resources: () => import('../locales/en/resources.json'),
    navigation: () => import('../locales/en/navigation.json'),
    auth: () => import('../locales/en/auth.json'),
    topics: () => import('../locales/en/topics.json'),
    groups: () => import('../locales/en/groups.json'),
    sharedEnvs: () => import('../locales/en/sharedEnvs.json'),
    profile: () => import('../locales/en/profile.json'),
    audit: () => import('../locales/en/audit.json'),
    connect: () => import('../locales/en/connect.json'),
    system: () => import('../locales/en/system.json'),
    superuser: () => import('../locales/en/superuser.json'),
  },
  zh: {
    common: () => import('../locales/zh/common.json'),
    apps: () => import('../locales/zh/apps.json'),
    deploy: () => import('../locales/zh/deploy.json'),
    docker: () => import('../locales/zh/docker.json'),
    publish: () => import('../locales/zh/publish.json'),
    space: () => import('../locales/zh/space.json'),
    feeds: () => import('../locales/zh/feeds.json'),
    secrets: () => import('../locales/zh/secrets.json'),
    certificates: () => import('../locales/zh/certificates.json'),
    store: () => import('../locales/zh/store.json'),
    aiCopilot: () => import('../locales/zh/aiCopilot.json'),
    aiAgent: () => import('../locales/zh/aiAgent.json'),
    resources: () => import('../locales/zh/resources.json'),
    navigation: () => import('../locales/zh/navigation.json'),
    auth: () => import('../locales/zh/auth.json'),
    topics: () => import('../locales/zh/topics.json'),
    groups: () => import('../locales/zh/groups.json'),
    sharedEnvs: () => import('../locales/zh/sharedEnvs.json'),
    profile: () => import('../locales/zh/profile.json'),
    audit: () => import('../locales/zh/audit.json'),
    connect: () => import('../locales/zh/connect.json'),
    system: () => import('../locales/zh/system.json'),
    superuser: () => import('../locales/zh/superuser.json'),
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

export function tWithFallback(
  t: TFunction,
  key: string,
  fallback: string,
  values?: Record<string, unknown>
) {
  const translated = t(key, values)
  return translated === key ? fallback : translated
}
