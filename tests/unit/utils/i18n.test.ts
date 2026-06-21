import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  t,
  getLocale,
  setLocale,
  registerLocale,
  getSupportedLocales,
} from '../../../src/renderer/src/i18n/index'

// Reset module state between tests by resetting locale to 'en'
beforeEach(() => {
  setLocale('en')
})

afterEach(() => {
  setLocale('en')
})

describe('i18n – t()', () => {
  it('returns the English translation for a known key', () => {
    expect(t('sidebar.connections')).toBe('Connections')
  })

  it('returns the English translation for another known key', () => {
    expect(t('common.close')).toBe('Close')
  })

  it('interpolates {param} placeholders', () => {
    const result = t('status.rowCount', { count: 5, plural: 's', ms: 42 })
    expect(result).toBe('5 rows in 42ms')
  })

  it('interpolates multiple distinct placeholders', () => {
    const result = t('status.updateAvailable', { version: '2.0.0' })
    expect(result).toBe('Update available: v2.0.0')
  })

  it('returns the raw key when the key is not registered in any locale', () => {
    // Cast to bypass TypeScript narrowing – simulates a missing key at runtime
    const result = t('nonexistent.key' as Parameters<typeof t>[0])
    expect(result).toBe('nonexistent.key')
  })
})

describe('i18n – getLocale() / setLocale()', () => {
  it('defaults to "en"', () => {
    expect(getLocale()).toBe('en')
  })

  it('switches to a registered locale', () => {
    setLocale('fr')
    expect(getLocale()).toBe('fr')
  })

  it('does not switch to an unregistered locale', () => {
    setLocale('fr')
    setLocale('zz')
    expect(getLocale()).toBe('en')
  })

  it('notifies subscribers when locale changes', () => {
    const notify = vi.fn()
    ;(globalThis as { __notifyLocaleChange?: () => void }).__notifyLocaleChange = notify
    setLocale('fr')
    expect(notify).toHaveBeenCalledOnce()
    ;(globalThis as { __notifyLocaleChange?: () => void }).__notifyLocaleChange = undefined
  })

  it('returns translated strings after locale switch', () => {
    setLocale('de')
    expect(t('common.close')).toBe('Schließen')
  })

  it('returns translated strings in French', () => {
    setLocale('fr')
    expect(t('common.close')).toBe('Fermer')
  })

  it('returns translated strings in Spanish', () => {
    setLocale('es')
    expect(t('common.close')).toBe('Cerrar')
  })

  it('returns translated strings in Japanese', () => {
    setLocale('ja')
    expect(t('common.close')).toBe('閉じる')
  })

  it('returns translated strings in Vietnamese', () => {
    setLocale('vi')
    expect(t('common.close')).toBe('Đóng')
  })
})

describe('i18n – registerLocale()', () => {
  it('allows registering a new locale and translating with it', () => {
    registerLocale('test', { 'common.close': 'Schließen' })
    setLocale('test')
    expect(t('common.close')).toBe('Schließen')
  })

  it('falls back to English for keys missing in a custom locale', () => {
    registerLocale('partial', { 'common.close': 'Custom Close' })
    setLocale('partial')
    // 'common.delete' is not in the partial locale → falls back to 'en'
    expect(t('common.delete')).toBe('Delete')
  })
})

describe('i18n – getSupportedLocales()', () => {
  it('includes all built-in locales', () => {
    const locales = getSupportedLocales()
    expect(locales).toContain('en')
    expect(locales).toContain('fr')
    expect(locales).toContain('de')
    expect(locales).toContain('es')
    expect(locales).toContain('ja')
    expect(locales).toContain('vi')
  })

  it('includes newly registered locales', () => {
    registerLocale('pt', { 'common.close': 'Fechar' })
    expect(getSupportedLocales()).toContain('pt')
  })
})
