import { afterEach, describe, expect, it } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'
import { isSafeExternalUrl, isTrustedRendererUrl } from '../../../src/main/security'

const originalRendererUrl = process.env.ELECTRON_RENDERER_URL

describe('main security policy', () => {
  afterEach(() => {
    if (originalRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL
    } else {
      process.env.ELECTRON_RENDERER_URL = originalRendererUrl
    }
  })

  it('allows only safe external protocols', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:support@example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(false)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('trusts renderer origin during development', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'

    expect(isTrustedRendererUrl('http://localhost:5173/#/')).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/settings')).toBe(true)
    expect(isTrustedRendererUrl('https://evil.example')).toBe(false)
  })

  it('trusts packaged renderer entry file in production', () => {
    delete process.env.ELECTRON_RENDERER_URL
    const expectedRendererEntry = pathToFileURL(
      path.resolve(__dirname, '../../../src/renderer/index.html')
    ).toString()
    const expectedRendererEntryWithSearchAndHash = `${expectedRendererEntry}?ts=1#/home`

    expect(isTrustedRendererUrl(expectedRendererEntry)).toBe(true)
    expect(isTrustedRendererUrl(expectedRendererEntryWithSearchAndHash)).toBe(true)
    expect(isTrustedRendererUrl('file:///tmp/malicious/index.html')).toBe(false)
    expect(isTrustedRendererUrl('file:///opt/KobeanSQL/out/renderer/other.html')).toBe(false)
    expect(isTrustedRendererUrl('https://example.com')).toBe(false)
  })
})
