import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: { file: { level: 'info', getFile: vi.fn(() => ({ path: path.join(os.tmpdir(), 'kobeansql.log') })) } }
  }
}))

// We need to mock `electron` because store.ts calls `app.getPath` and `safeStorage`
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir())
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((buf: Buffer) => buf.toString())
  }
}))

vi.mock('../src/main/local-store', () => ({
  localStore: {
    getSavedQueries: vi.fn(() => []),
    addSavedQuery: vi.fn(),
    deleteSavedQuery: vi.fn()
  }
}))

describe('Connection Store (persistence)', () => {
  const storePath = path.join(os.tmpdir(), 'connections.json')
  const importPath = path.join(os.tmpdir(), 'connections-import.json')
  const exportPath = path.join(os.tmpdir(), 'connections-export.json')
  const settingsPath = path.join(os.tmpdir(), 'settings.json')
  const defaultSettings = {
    queryLimit: 100,
    updates: {
      autoCheckEnabled: true,
      checkIntervalHours: 24,
      cache: {}
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Clean up any leftover file
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath)
    if (fs.existsSync(importPath)) fs.unlinkSync(importPath)
    if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath)
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath)
  })

  afterEach(() => {
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath)
    if (fs.existsSync(importPath)) fs.unlinkSync(importPath)
    if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath)
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath)
  })

  it('loadConnections returns empty array when no file exists', async () => {
    const { loadConnections } = await import('../src/main/store')
    const result = loadConnections()
    expect(result).toEqual([])
  })

  it('saveConnections persists data and loadConnections reads it back', async () => {
    const { loadConnections, saveConnections } = await import('../src/main/store')

    const conns = [
      { id: 'c1', name: 'Local PG', type: 'postgres' as const, host: 'localhost', port: 5432 },
      { id: 'c2', name: 'Local MySQL', type: 'mysql' as const, host: 'localhost', port: 3306 }
    ]

    saveConnections(conns)
    const loaded = loadConnections()
    expect(loaded).toHaveLength(2)
    expect(loaded[0].name).toBe('Local PG')
    expect(loaded[1].type).toBe('mysql')
  })

  it('saveConnections persists passwords so saved connections can reconnect', async () => {
    const { saveConnections } = await import('../src/main/store')
    saveConnections([
      {
        id: 'c1',
        name: 'Secret',
        type: 'postgres',
        host: 'localhost',
        password: 'super-secret'
      }
    ])

    const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as { connections: Array<Record<string, unknown>> }
    expect(raw.connections[0]).toHaveProperty('password', 'super-secret')
  })

  it('saveConnections encrypts passwords when safeStorage is available and loadConnections decrypts them', async () => {
    const electron = await import('electron')
    const mockSafe = electron.safeStorage as {
      isEncryptionAvailable: ReturnType<typeof vi.fn>
      encryptString: ReturnType<typeof vi.fn>
      decryptString: ReturnType<typeof vi.fn>
    }
    // Simulate encryption being available
    mockSafe.isEncryptionAvailable.mockReturnValueOnce(true)
    mockSafe.encryptString.mockReturnValueOnce(Buffer.from('ENCRYPTED'))
    mockSafe.decryptString.mockReturnValueOnce('super-secret')

    const { loadConnections, saveConnections } = await import('../src/main/store')
    saveConnections([{ id: 'c1', name: 'Enc', type: 'postgres', host: 'localhost', password: 'super-secret' }])

    const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as { connections: Array<Record<string, unknown>> }
    // Stored password should carry the enc: prefix, not plaintext
    expect(raw.connections[0].password as string).toMatch(/^enc:/)

    // loadConnections should decrypt it back to the original value
    const loaded = loadConnections()
    expect(loaded[0].password).toBe('super-secret')
  })

  it('loadConnections returns empty array on malformed JSON', async () => {
    fs.writeFileSync(storePath, 'not valid json', 'utf-8')
    const { loadConnections } = await import('../src/main/store')
    const result = loadConnections()
    expect(result).toEqual([])
  })

  it('loadConnections drops invalid encrypted passwords', async () => {
    const electron = await import('electron')
    const mockSafe = electron.safeStorage as {
      decryptString: ReturnType<typeof vi.fn>
    }
    mockSafe.decryptString.mockImplementationOnce(() => {
      throw new Error('decrypt failure')
    })
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        connections: [{ id: 'c1', name: 'Broken', type: 'postgres', password: 'enc:invalid-base64' }]
      }, null, 2),
      'utf-8'
    )

    const { loadConnections } = await import('../src/main/store')
    const loaded = loadConnections()
    expect(loaded[0].password).toBeUndefined()
  })

  it('exportConnectionsToPath omits passwords by default', async () => {
    const { saveConnections, exportConnectionsToPath } = await import('../src/main/store')
    saveConnections([{ id: 'c1', name: 'Secured', type: 'postgres', password: 'secret' }])
    exportConnectionsToPath(exportPath)

    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8')) as {
      includePasswords: boolean
      connections: Array<Record<string, unknown>>
    }
    expect(exported.includePasswords).toBe(false)
    expect(exported.connections[0].password).toBeUndefined()
  })

  it('exportConnectionsToPath includes encrypted passwords when requested', async () => {
    const electron = await import('electron')
    const mockSafe = electron.safeStorage as {
      isEncryptionAvailable: ReturnType<typeof vi.fn>
      encryptString: ReturnType<typeof vi.fn>
    }
    mockSafe.isEncryptionAvailable.mockReturnValueOnce(true)
    mockSafe.encryptString.mockReturnValueOnce(Buffer.from('ENCRYPTED'))

    const { saveConnections, exportConnectionsToPath } = await import('../src/main/store')
    saveConnections([{ id: 'c1', name: 'Secured', type: 'postgres', password: 'secret' }])
    exportConnectionsToPath(exportPath, true)

    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8')) as {
      includePasswords: boolean
      connections: Array<Record<string, unknown>>
    }
    expect(exported.includePasswords).toBe(true)
    expect(exported.connections[0].password).toMatch(/^enc:/)
  })

  it('importConnectionsFromPath validates, replaces by id and skips duplicates', async () => {
    const { saveConnections, importConnectionsFromPath, loadConnections } = await import('../src/main/store')
    saveConnections([
      { id: 'c1', name: 'PG Local', type: 'postgres', host: 'localhost' },
      { id: 'c2', name: 'MySQL Local', type: 'mysql', host: 'localhost' }
    ])

    fs.writeFileSync(
      importPath,
      JSON.stringify(
        {
          connections: [
            { id: 'c1', name: 'PG Local Updated', type: 'postgres', host: '127.0.0.1' }, // replace
            { id: 'c3', name: 'MySQL Local', type: 'mysql', host: 'localhost' }, // duplicate fingerprint
            { id: 'c4', name: 'SQLite New', type: 'sqlite', filename: '/tmp/new.db' }, // import
            { id: 'c5', name: 'Mongo App', type: 'mongodb', host: 'localhost', port: 27017 }, // import
            { id: 12, type: 'postgres' }, // invalid id
            { id: 'bad-1', type: 'postgres' }, // missing name
            { id: 'bad-2', name: 'Unknown', type: 'oracle' } // invalid type
          ]
        },
        null,
        2
      ),
      'utf-8'
    )

    const result = importConnectionsFromPath(importPath)
    expect(result).toEqual({
      imported: 2,
      replaced: 1,
      skippedDuplicates: 1,
      skippedInvalid: 3
    })
    const loaded = loadConnections()
    expect(loaded.find((c) => c.id === 'c1')?.name).toBe('PG Local Updated')
    expect(loaded.some((c) => c.id === 'c4')).toBe(true)
    expect(loaded.some((c) => c.id === 'c5' && c.type === 'mongodb')).toBe(true)
  })

  it('loadSettings returns defaults when file is missing', async () => {
    const { loadSettings } = await import('../src/main/store')
    expect(loadSettings()).toEqual(defaultSettings)
  })

  it('loadSettings returns defaults on malformed JSON', async () => {
    fs.writeFileSync(settingsPath, '{bad json', 'utf-8')
    const { loadSettings } = await import('../src/main/store')
    expect(loadSettings()).toEqual(defaultSettings)
  })

  it('loadSettings sanitizes type and range for queryLimit', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ queryLimit: '50000' }), 'utf-8')
    const { loadSettings } = await import('../src/main/store')
    expect(loadSettings()).toEqual({ ...defaultSettings, queryLimit: 10000 })

    fs.writeFileSync(settingsPath, JSON.stringify({ queryLimit: -5 }), 'utf-8')
    expect(loadSettings()).toEqual({ ...defaultSettings, queryLimit: 1 })
  })

  it('saveSettings sanitizes queryLimit before writing', async () => {
    const { saveSettings } = await import('../src/main/store')
    saveSettings({ ...defaultSettings, queryLimit: 'abc' as unknown as number })
    const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { queryLimit: number }
    expect(stored.queryLimit).toBe(100)
  })

  it('loadSettings sanitizes update settings and cache', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        updates: {
          autoCheckEnabled: 'yes',
          checkIntervalHours: 999,
          ignoredVersion: '  v2.0.0  ',
          dismissedVersion: '',
          dismissedAt: '-10',
          cache: {
            etag: '  abc123  ',
            latestVersion: ' v1.9.0 ',
            releaseUrl: ' https://github.com/example ',
            checkedAt: '12345'
          }
        }
      }),
      'utf-8'
    )
    const { loadSettings } = await import('../src/main/store')
    expect(loadSettings()).toEqual({
      ...defaultSettings,
      updates: {
        autoCheckEnabled: true,
        checkIntervalHours: 168,
        ignoredVersion: 'v2.0.0',
        dismissedVersion: undefined,
        dismissedAt: undefined,
        cache: {
          etag: 'abc123',
          latestVersion: 'v1.9.0',
          releaseUrl: 'https://github.com/example',
          releaseName: undefined,
          checkedAt: 12345
        }
      }
    })
  })

  it('saveSettings sanitizes update interval bounds', async () => {
    const { saveSettings } = await import('../src/main/store')
    saveSettings({
      ...defaultSettings,
      updates: {
        ...defaultSettings.updates,
        checkIntervalHours: 1
      }
    })
    const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      updates: { checkIntervalHours: number }
    }
    expect(stored.updates.checkIntervalHours).toBe(6)
  })

  it('loadSettings sanitizes ai settings with provider defaults', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ai: {
          provider: 'openai-compatible',
          baseUrl: '   ',
          model: ''
        }
      }),
      'utf-8'
    )

    const { loadSettings } = await import('../src/main/store')
    expect(loadSettings()).toEqual({
      ...defaultSettings,
      ai: {
        provider: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'local-model'
      }
    })
  })
})
