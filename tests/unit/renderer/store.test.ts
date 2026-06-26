import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig, DatabaseManagementCapabilities } from '../../../src/renderer/src/types'

type DbApi = NonNullable<(typeof globalThis & { window?: { db?: unknown } })['window']>['db']

function createDbMock(overrides: Partial<Record<string, unknown>> = {}): DbApi {
  return {
    getConnections: vi.fn().mockResolvedValue([]),
    saveConnection: vi.fn().mockResolvedValue({ success: true }),
    deleteConnection: vi.fn().mockResolvedValue({ success: true }),
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue({ success: true }),
    isConnected: vi.fn().mockResolvedValue(false),
    query: vi.fn().mockResolvedValue({ columns: [], rows: [], rowCount: 0, duration: 1 }),
    getCapabilitiesForType: vi.fn().mockResolvedValue({
      canInsertRow: false,
      canDeleteRow: false,
      canDuplicateRow: false,
      canInlineUpdateRow: false,
      canCopyTable: false,
      canManageSchema: false,
      supportsForeignKeys: false,
      supportsProcedures: false
    } satisfies DatabaseManagementCapabilities),
    getDatabases: vi.fn().mockResolvedValue([]),
    getTables: vi.fn().mockResolvedValue([]),
    getColumns: vi.fn().mockResolvedValue([]),
    getProcedures: vi.fn().mockResolvedValue([]),
    getSavedQueries: vi.fn().mockResolvedValue([]),
    saveQuery: vi.fn().mockResolvedValue({ success: true }),
    deleteQuery: vi.fn().mockResolvedValue({ success: true }),
    getServerVersion: vi.fn().mockResolvedValue({ version: 'Unknown' }),
    getSettings: vi.fn().mockResolvedValue({ queryLimit: 100 }),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    addConnectionLog: vi.fn().mockResolvedValue({ success: true }),
    getConnectionLogs: vi.fn().mockResolvedValue([]),
    clearConnectionLogs: vi.fn().mockResolvedValue({ success: true }),
    addToPersistedHistory: vi.fn().mockResolvedValue({ success: true }),
    getPersistedHistory: vi.fn().mockResolvedValue([]),
    clearPersistedHistory: vi.fn().mockResolvedValue({ success: true }),
    setSchemaCache: vi.fn().mockResolvedValue({ success: true }),
    getSchemaCache: vi.fn().mockResolvedValue(null),
    clearSchemaCache: vi.fn().mockResolvedValue({ success: true }),
    ...(overrides as DbApi)
  }
}

async function loadStoreWithDb(db: DbApi) {
  vi.resetModules()
  ;(globalThis as typeof globalThis & { window?: { db: DbApi } }).window = { db }
  const { useAppStore } = await import('../../../src/renderer/src/store')
  return useAppStore
}

describe('renderer store connection metadata races', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not restore server version after disconnect if async version arrives late', async () => {
    let resolveVersion: ((value: { version: string }) => void) | null = null
    const delayedVersionPromise = new Promise<{ version: string }>((resolve) => {
      resolveVersion = resolve
    })
    const db = createDbMock({
      getServerVersion: vi.fn().mockReturnValue(delayedVersionPromise)
    })

    const useAppStore = await loadStoreWithDb(db)
    const config: ConnectionConfig = { id: 'c1', name: 'Prod PG', type: 'postgres', host: 'localhost' }
    useAppStore.setState({ connections: [config] })

    await useAppStore.getState().connect(config)
    await useAppStore.getState().disconnect(config.id)

    resolveVersion?.({ version: 'PostgreSQL 16.4 on x86_64' })
    await Promise.resolve()
    await Promise.resolve()

    expect(useAppStore.getState().connectedIds.has(config.id)).toBe(false)
    expect(useAppStore.getState().connectionVersions[config.id]).toBeUndefined()
  })

  it('loads and stores per-connection management capabilities', async () => {
    const caps: DatabaseManagementCapabilities = {
      canInsertRow: true,
      canDeleteRow: true,
      canDuplicateRow: true,
      canInlineUpdateRow: true,
      canCopyTable: true,
      canManageSchema: true,
      supportsForeignKeys: true,
      supportsProcedures: true
    }
    const db = createDbMock({
      getCapabilitiesForType: vi.fn().mockResolvedValue(caps)
    })
    const useAppStore = await loadStoreWithDb(db)
    const config: ConnectionConfig = { id: 'pg-1', name: 'Prod PG', type: 'postgres', host: 'localhost' }

    useAppStore.setState({
      connections: [config],
      connectedIds: new Set([config.id])
    })

    await useAppStore.getState().loadConnectionCapabilities(config.id, config.type)

    expect(db.getCapabilitiesForType).toHaveBeenCalledWith('postgres')
    expect(useAppStore.getState().connectionCapabilities['pg-1']).toEqual(caps)
  })

  it('does not restore capabilities after disconnect if async capability lookup arrives late', async () => {
    const caps: DatabaseManagementCapabilities = {
      canInsertRow: true,
      canDeleteRow: true,
      canDuplicateRow: true,
      canInlineUpdateRow: true,
      canCopyTable: true,
      canManageSchema: true,
      supportsForeignKeys: true,
      supportsProcedures: true
    }
    let resolveCapabilities: ((value: DatabaseManagementCapabilities) => void) | null = null
    const delayedCapabilitiesPromise = new Promise<DatabaseManagementCapabilities>((resolve) => {
      resolveCapabilities = resolve
    })
    const db = createDbMock({
      getCapabilitiesForType: vi.fn().mockReturnValue(delayedCapabilitiesPromise)
    })

    const useAppStore = await loadStoreWithDb(db)
    const config: ConnectionConfig = { id: 'c1', name: 'Prod PG', type: 'postgres', host: 'localhost' }
    useAppStore.setState({ connections: [config] })

    const connectPromise = useAppStore.getState().connect(config)
    await Promise.resolve()
    await Promise.resolve()
    await useAppStore.getState().disconnect(config.id)

    resolveCapabilities?.(caps)
    await connectPromise
    await Promise.resolve()
    await Promise.resolve()

    expect(useAppStore.getState().connectedIds.has(config.id)).toBe(false)
    expect(useAppStore.getState().connectionCapabilities[config.id]).toBeUndefined()
  })
})
