import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openExternalMock = vi.fn()
const openPathMock = vi.fn()
const isOnlineMock = vi.fn(() => true)
const getVersionMock = vi.fn(() => '1.0.0')

let currentSettings = {
  queryLimit: 100,
  updates: {
    autoCheckEnabled: true,
    checkIntervalHours: 24,
    cache: {
      downloadUrl: 'https://github.com/kobenguyent/KobeanSQL/releases/download/v2.0.0/KobeanSQL.AppImage'
    }
  }
}

const loadSettingsMock = vi.fn(() => currentSettings)
const saveSettingsMock = vi.fn((next) => {
  currentSettings = next
})
const originalProcessPlatform = process.platform
const originalProcessArch = process.arch

function unlinkIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getVersion: getVersionMock
  },
  net: {
    isOnline: isOnlineMock
  },
  shell: {
    openExternal: openExternalMock,
    openPath: openPathMock
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

vi.mock('../../../src/main/store', () => ({
  loadSettings: loadSettingsMock,
  saveSettings: saveSettingsMock
}))

vi.mock('../../../src/main/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

function makeBody(chunks: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(chunks))
      controller.close()
    }
  })
}

describe('update service downloads', () => {
  const downloadedFile = path.join(os.tmpdir(), 'kobeansql-update', 'KobeanSQL.AppImage')
  const downloadedFileVersioned = path.join(os.tmpdir(), 'kobeansql-update', 'KobeanSQL.2.0.0.AppImage')

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    currentSettings = {
      queryLimit: 100,
      updates: {
        autoCheckEnabled: true,
        checkIntervalHours: 24,
        cache: {
          downloadUrl: 'https://github.com/kobenguyent/KobeanSQL/releases/download/v2.0.0/KobeanSQL.AppImage'
        }
      }
    }
    unlinkIfExists(downloadedFile)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(process, 'platform', { value: originalProcessPlatform })
    Object.defineProperty(process, 'arch', { value: originalProcessArch })
    unlinkIfExists(downloadedFile)
    unlinkIfExists(downloadedFileVersioned)
  })

  it('follows only validated redirect hosts for update downloads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://objects.githubusercontent.com/github-production-release-asset/test/KobeanSQL.AppImage' }
      }))
      .mockResolvedValueOnce(new Response(makeBody([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' }
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { createUpdateService } = await import('../../../src/main/update/service')
    const service = createUpdateService()
    const status = await service.downloadUpdate()

    expect(status.downloadState).toBe('ready')
    expect(status.downloadProgress).toBe(100)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      currentSettings.updates.cache.downloadUrl,
      expect.objectContaining({ redirect: 'manual' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://objects.githubusercontent.com/github-production-release-asset/test/KobeanSQL.AppImage',
      expect.objectContaining({ redirect: 'manual' })
    )
    expect(fs.existsSync(downloadedFile)).toBe(true)
  })

  it('rejects redirected downloads to untrusted hosts', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example.com/KobeanSQL.AppImage' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { createUpdateService } = await import('../../../src/main/update/service')
    const service = createUpdateService()
    const status = await service.downloadUpdate()

    expect(status.downloadState).toBe('error')
    expect(status.downloadError).toBe('Invalid download URL.')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fs.existsSync(downloadedFile)).toBe(false)
  })

  it('force-refreshes release data when downloadUrl is missing from cache', async () => {
    // Simulate a legacy/stale cache that has no downloadUrl field
    currentSettings = {
      queryLimit: 100,
      updates: {
        autoCheckEnabled: true,
        checkIntervalHours: 24,
        cache: {
          etag: 'stale-etag',
          latestVersion: '2.0.0'
          // no downloadUrl
        }
      }
    } as typeof currentSettings

    const releaseBody = JSON.stringify({
      tag_name: 'v2.0.0',
      html_url: 'https://github.com/kobenguyent/KobeanSQL/releases/tag/v2.0.0',
      assets: [
        {
          name: 'KobeanSQL.2.0.0.AppImage',
          browser_download_url:
            'https://github.com/kobenguyent/KobeanSQL/releases/download/v2.0.0/KobeanSQL.2.0.0.AppImage',
          size: 3
        }
      ]
    })

    const fetchMock = vi.fn()
      // First call: forced fresh check (no ETag header) → 200 with assets
      .mockResolvedValueOnce(new Response(releaseBody, { status: 200, headers: { etag: 'new-etag' } }))
      // Second call: initial GET for download (may redirect)
      .mockResolvedValueOnce(new Response(makeBody([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' }
      }))
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(process, 'platform', { value: 'linux' })

    const { createUpdateService } = await import('../../../src/main/update/service')
    const service = createUpdateService()
    const status = await service.downloadUpdate()

    // The forced fetch must NOT have sent an ETag header
    const [, firstFetchOptions] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((firstFetchOptions.headers as Record<string, string>)['If-None-Match']).toBeUndefined()

    expect(status.downloadState).toBe('ready')
    expect(status.downloadProgress).toBe(100)
    expect(fs.existsSync(downloadedFileVersioned)).toBe(true)
  })

  it('prefers arm64 mac assets and falls back to zip when selecting download URL', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: 'v2.0.0',
          html_url: 'https://github.com/kobenguyent/KobeanSQL/releases/tag/v2.0.0',
          assets: [
            {
              name: 'KobeanSQL-2.0.0-x64.dmg',
              browser_download_url:
                'https://github.com/kobenguyent/KobeanSQL/releases/download/v2.0.0/KobeanSQL-2.0.0-x64.dmg'
            },
            {
              name: 'KobeanSQL-2.0.0-arm64-mac.zip',
              browser_download_url:
                'https://github.com/kobenguyent/KobeanSQL/releases/download/v2.0.0/KobeanSQL-2.0.0-arm64-mac.zip'
            }
          ]
        }),
        { status: 200, headers: { etag: 'abc' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const { createUpdateService } = await import('../../../src/main/update/service')
    const service = createUpdateService()
    await service.checkForUpdates(true)

    expect(currentSettings.updates.cache.downloadUrl).toBe(
      'https://github.com/kobenguyent/KobeanSQL/releases/download/v2.0.0/KobeanSQL-2.0.0-arm64-mac.zip'
    )
  })
})
