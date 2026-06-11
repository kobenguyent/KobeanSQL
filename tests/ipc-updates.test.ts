import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'

const handleMock = vi.fn()
const getAllWindowsMock = vi.fn(() => [])
const loadSettingsMock = vi.fn(() => ({
  queryLimit: 100,
  updates: { autoCheckEnabled: true, checkIntervalHours: 24, cache: {} }
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: getAllWindowsMock },
  ipcMain: { handle: handleMock },
  dialog: {},
  shell: { openPath: vi.fn() }
}))

vi.mock('../src/main/store', () => ({
  loadConnections: vi.fn(() => []),
  saveConnections: vi.fn(),
  loadSavedQueries: vi.fn(() => []),
  writeSavedQueries: vi.fn(),
  loadSettings: loadSettingsMock,
  sanitizeSettings: vi.fn((s) => s),
  saveSettings: vi.fn(),
  exportConnectionsToPath: vi.fn(),
  importConnectionsFromPath: vi.fn()
}))

vi.mock('../src/main/ai/service', () => ({
  createLocalAIService: vi.fn(() => ({
    getSettings: vi.fn(() => ({})),
    runTask: vi.fn()
  }))
}))

function getTrustedEvent(): { senderFrame: { url: string } } {
  return {
    senderFrame: {
      url: pathToFileURL(path.resolve(__dirname, '../src/renderer/index.html')).toString()
    }
  }
}

function getHandlers() {
  return Object.fromEntries(
    handleMock.mock.calls.map(([channel, fn]: [string, (...args: unknown[]) => Promise<unknown>]) => [channel, fn])
  )
}

function getManagerStub() {
  return {
    on: vi.fn(),
    disconnectAll: vi.fn(),
    disconnect: vi.fn(),
    testConnection: vi.fn(),
    connect: vi.fn(),
    isConnected: vi.fn(),
    query: vi.fn(),
    getDatabases: vi.fn(),
    getTables: vi.fn(),
    getColumns: vi.fn(),
    getForeignKeys: vi.fn(),
    getProcedures: vi.fn(),
    getServerVersion: vi.fn()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IPC updates channels', () => {
  beforeEach(() => {
    handleMock.mockReset()
    getAllWindowsMock.mockReset()
    getAllWindowsMock.mockReturnValue([])
    loadSettingsMock.mockReset()
    loadSettingsMock.mockReturnValue({
      queryLimit: 100,
      updates: { autoCheckEnabled: true, checkIntervalHours: 24, cache: {} }
    })
  })

  it('wires update status and actions through update service', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const updateService = {
      reschedule: vi.fn(),
      getStatus: vi.fn(() => ({ checking: false })),
      checkForUpdates: vi.fn(async () => ({ checking: false, updateAvailable: false })),
      ignoreVersion: vi.fn(async () => ({ ignoredVersion: '1.2.3' })),
      dismissVersion: vi.fn(async () => ({ dismissedVersion: '1.2.3' })),
      openReleasePage: vi.fn(async () => ({ success: true, url: 'https://example.com' })),
      downloadUpdate: vi.fn(async () => ({ downloadState: 'ready', downloadProgress: 100 })),
      installUpdate: vi.fn(async () => ({ success: true }))
    }
    const manager = getManagerStub()

    registerIpcHandlers(manager as never, updateService as never)

    const handlers = getHandlers()
    const trustedEvent = getTrustedEvent()

    expect(await handlers['updates:get-status'](trustedEvent)).toEqual({ checking: false })
    expect(await handlers['updates:check-now'](trustedEvent)).toEqual({ checking: false, updateAvailable: false })
    expect(await handlers['updates:ignore-version'](trustedEvent, '1.2.3')).toEqual({ ignoredVersion: '1.2.3' })
    expect(await handlers['updates:dismiss-version'](trustedEvent, '1.2.3')).toEqual({ dismissedVersion: '1.2.3' })
    expect(await handlers['updates:open-release'](trustedEvent, 'https://example.com')).toEqual({
      success: true,
      url: 'https://example.com'
    })

    expect(updateService.checkForUpdates).toHaveBeenCalledWith(true)
    expect(updateService.ignoreVersion).toHaveBeenCalledWith('1.2.3')
    expect(updateService.dismissVersion).toHaveBeenCalledWith('1.2.3')
    expect(updateService.openReleasePage).toHaveBeenCalledWith('https://example.com')
  })

  it('delegates download to update service', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const downloadStatus = { downloadState: 'ready', downloadProgress: 100 }
    const updateService = {
      reschedule: vi.fn(),
      getStatus: vi.fn(() => ({ checking: false })),
      checkForUpdates: vi.fn(),
      ignoreVersion: vi.fn(),
      dismissVersion: vi.fn(),
      openReleasePage: vi.fn(),
      downloadUpdate: vi.fn(async () => downloadStatus),
      installUpdate: vi.fn()
    }

    registerIpcHandlers(getManagerStub() as never, updateService as never)
    const handlers = getHandlers()

    const result = await handlers['updates:download'](getTrustedEvent())
    expect(result).toEqual(downloadStatus)
    expect(updateService.downloadUpdate).toHaveBeenCalledOnce()
  })

  it('delegates install to update service', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const updateService = {
      reschedule: vi.fn(),
      getStatus: vi.fn(() => ({ checking: false })),
      checkForUpdates: vi.fn(),
      ignoreVersion: vi.fn(),
      dismissVersion: vi.fn(),
      openReleasePage: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(async () => ({ success: true }))
    }

    registerIpcHandlers(getManagerStub() as never, updateService as never)
    const handlers = getHandlers()

    const result = await handlers['updates:install'](getTrustedEvent())
    expect(result).toEqual({ success: true })
    expect(updateService.installUpdate).toHaveBeenCalledOnce()
  })

  it('returns null for download when no update service', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    registerIpcHandlers(getManagerStub() as never)
    const handlers = getHandlers()
    expect(await handlers['updates:download'](getTrustedEvent())).toBeNull()
  })

  it('returns error for install when no update service', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    registerIpcHandlers(getManagerStub() as never)
    const handlers = getHandlers()
    const result = await handlers['updates:install'](getTrustedEvent())
    expect(result).toMatchObject({ success: false })
  })

  it('skips destroyed windows when forwarding connection-lost', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const manager = getManagerStub()
    const sendLive = vi.fn()
    const sendDestroyed = vi.fn()
    getAllWindowsMock.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: sendLive
        }
      },
      {
        isDestroyed: () => true,
        webContents: {
          isDestroyed: () => false,
          send: sendDestroyed
        }
      },
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => true,
          send: sendDestroyed
        }
      }
    ])

    registerIpcHandlers(manager as never)
    const onConnectionLost = manager.on.mock.calls.find(([event]: [string]) => event === 'connection-lost')?.[1] as
      | ((connectionId: string) => void)
      | undefined

    expect(onConnectionLost).toBeTypeOf('function')
    expect(() => onConnectionLost?.('conn-1')).not.toThrow()
    expect(sendLive).toHaveBeenCalledWith('db:connection-lost', 'conn-1')
    expect(sendDestroyed).not.toHaveBeenCalled()
  })
})

describe('IPC ai:list-models channel', () => {
  beforeEach(() => {
    handleMock.mockReset()
    loadSettingsMock.mockReset()
    loadSettingsMock.mockReturnValue({
      queryLimit: 100,
      updates: { autoCheckEnabled: true, checkIntervalHours: 24, cache: {} }
    })
  })

  it('lists Ollama models from /api/tags with timeout signal', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.1' }, { name: 'mistral' }] })
    }))
    vi.stubGlobal('fetch', fetchMock)
    loadSettingsMock.mockReturnValue({
      queryLimit: 100,
      updates: { autoCheckEnabled: true, checkIntervalHours: 24, cache: {} },
      ai: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1' }
    })

    registerIpcHandlers(getManagerStub() as never)
    const handlers = getHandlers()
    const result = await handlers['ai:list-models'](getTrustedEvent())

    expect(result).toEqual({ success: true, models: ['llama3.1', 'mistral'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ signal: expect.any(Object) })
    )
  })

  it('normalizes OpenAI-compatible /v1/models endpoint', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'local-model' }] })
    }))
    vi.stubGlobal('fetch', fetchMock)

    registerIpcHandlers(getManagerStub() as never)
    const handlers = getHandlers()
    const result = await handlers['ai:list-models'](getTrustedEvent(), {
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1/'
    })

    expect(result).toEqual({ success: true, models: ['local-model'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({ signal: expect.any(Object) })
    )
  })

  it('rejects non-local URLs before fetch', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    registerIpcHandlers(getManagerStub() as never)
    const handlers = getHandlers()
    const result = await handlers['ai:list-models'](getTrustedEvent(), {
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1'
    })

    expect(result).toEqual({
      success: false,
      models: [],
      error: expect.stringContaining('local-only policy')
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a failure payload when fetch rejects', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)

    registerIpcHandlers(getManagerStub() as never)
    const handlers = getHandlers()
    const result = await handlers['ai:list-models'](getTrustedEvent())

    expect(result).toEqual({ success: false, models: [], error: 'network down' })
  })
})

describe('IPC database mutation channels', () => {
  beforeEach(() => {
    handleMock.mockReset()
  })

  it('supports deleteRow, insertRow, and duplicateRow operations', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc')
    registerIpcHandlers(getManagerStub() as never)
    const handlers = getHandlers()

    expect(handlers['db:delete-row']).toBeTypeOf('function')
    expect(handlers['db:insert-row']).toBeTypeOf('function')
    expect(handlers['db:duplicate-row']).toBeTypeOf('function')

    const deleteRes = await handlers['db:delete-row'](getTrustedEvent(), 'my_table', { id: 1 })
    const insertRes = await handlers['db:insert-row'](getTrustedEvent(), 'my_table', { id: 1, name: 'test' })
    const duplicateRes = await handlers['db:duplicate-row'](getTrustedEvent(), 'my_table', { id: 1 })

    expect(deleteRes).toBe(true)
    expect(insertRes).toBe(true)
    expect(duplicateRes).toBe(true)
  })
})
