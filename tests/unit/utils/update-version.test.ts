import { describe, it, expect } from 'vitest'
import { compareVersions, isNewerVersion, normalizeVersion } from '../../../src/main/update/version'

describe('update version utils', () => {
  it('normalizes v-prefix', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
  })

  it('compares semantic versions correctly', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1)
  })

  it('treats release version as newer than prerelease', () => {
    expect(compareVersions('1.8.0', '1.8.0-rc.1')).toBe(1)
    expect(compareVersions('1.8.0-beta.2', '1.8.0-beta.1')).toBe(1)
  })

  it('detects new versions with v-prefix inputs', () => {
    expect(isNewerVersion('v1.9.0', '1.8.9')).toBe(true)
    expect(isNewerVersion('v1.8.2', 'v1.8.2')).toBe(false)
  })

  it('handles different core segment lengths', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })

  it('returns neutral comparison for invalid versions', () => {
    expect(compareVersions('bad.version', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3', 'invalid')).toBe(0)
  })
})
