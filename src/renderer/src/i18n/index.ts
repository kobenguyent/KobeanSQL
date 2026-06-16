import en from './locales/en'
import de from './locales/de'
import es from './locales/es'
import fr from './locales/fr'
import ja from './locales/ja'
import vi from './locales/vi'

const registry: any = { en, de, es, fr, ja, vi }
const storage = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} }
let cur = storage.getItem('kobeansql-locale') || 'en'
if (!registry[cur]) cur = 'en'

export const getLocale = () => cur
export const setLocale = (l: string) => {
  const next = registry[l] ? l : 'en'
  const changed = cur !== next
  cur = next
  storage.setItem('kobeansql-locale', cur)
  if (changed) ;(globalThis as any).__notifyLocaleChange?.()
}

export const t = (key: string, params?: Record<string, any>) => {
  let s = registry[cur][key] || registry.en[key] || key
  if (params) Object.entries(params).forEach(([k, v]) => s = s.replace(`{${k}}`, v))
  return s
}

export const getSupportedLocales = () => Object.keys(registry)
export const registerLocale = (l: string, m: any) => registry[l] = m
