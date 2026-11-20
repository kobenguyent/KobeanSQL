import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockAdapterClass } = vi.hoisted(() => ({
  mockAdapterClass: (dialect: string) =>
    class {
      dialect = dialect
      async connect() {}
      async disconnect() {}
      isConnected() { return true }
      async ping() { return true }
      async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
      async getDatabases() { return [] }
      async getTables() { return [] }
      async getColumns() { return [] }
      async getForeignKeys() { return [] }
      async getProcedures() { return [] }
      async getServerVersion() { return `${dialect} 1.0` }
    }
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('../../../src/main/db/adapters/mysql', () => ({ MySQLAdapter: mockAdapterClass('mysql') }))
vi.mock('../../../src/main/db/adapters/mariadb', () => ({ MariaDBAdapter: mockAdapterClass('mariadb') }))
vi.mock('../../../src/main/db/adapters/postgres', () => ({ PostgresAdapter: mockAdapterClass('postgres') }))
vi.mock('../../../src/main/db/adapters/sqlite', () => ({ SQLiteAdapter: mockAdapterClass('sqlite') }))
vi.mock('../../../src/main/db/adapters/mssql', () => ({ MSSQLAdapter: mockAdapterClass('mssql') }))
vi.mock('../../../src/main/db/adapters/mongodb', () => ({ MongoDBAdapter: mockAdapterClass('mongodb') }))
vi.mock('../../../src/main/db/adapters/cockroachdb', () => ({ CockroachDBAdapter: mockAdapterClass('cockroachdb') }))
vi.mock('../../../src/main/db/adapters/clickhouse', () => ({ ClickHouseAdapter: mockAdapterClass('clickhouse') }))
vi.mock('../../../src/main/db/adapters/cassandra', () => ({ CassandraAdapter: mockAdapterClass('cassandra') }))
vi.mock('../../../src/main/db/adapters/redis', () => ({ RedisAdapter: mockAdapterClass('redis') }))
vi.mock('../../../src/main/db/adapters/elasticsearch', () => ({ ElasticsearchAdapter: mockAdapterClass('elasticsearch') }))
vi.mock('../../../src/main/db/adapters/oracle', () => ({ OracleAdapter: mockAdapterClass('oracle') }))
vi.mock('../../../src/main/db/adapters/influxdb', () => ({ InfluxDBAdapter: mockAdapterClass('influxdb') }))
vi.mock('../../../src/main/db/adapters/neo4j', () => ({ Neo4jAdapter: mockAdapterClass('neo4j') }))
vi.mock('../../../src/main/db/adapters/snowflake', () => ({ SnowflakeAdapter: mockAdapterClass('snowflake') }))

import { ConnectionManager, type AutoDisconnectEventPayload } from '../../../src/main/db/manager'
import type { DatabaseAdapter } from '../../../src/main/db/adapter'
import type { ConnectionConfig } from '../../../src/main/db/types'

function createMockAdapter(
  dialect: ConnectionConfig['type'],
  overrides: Partial<DatabaseAdapter> = {}
): DatabaseAdapter {
  let connected = true
  return {
    dialect,
    connect: vi.fn(async () => {
      connected = true
    }),
    disconnect: vi.fn(async () => {
      connected = false
    }),
    isConnected: vi.fn(() => connected),
    ping: vi.fn(async () => connected),
    query: vi.fn(async () => ({ columns: [], rows: [], rowCount: 0, duration: 1 })),
    getDatabases: vi.fn(async () => ['main']),
    getTables: vi.fn(async () => []),
    getColumns: vi.fn(async () => []),
    getForeignKeys: vi.fn(async () => []),
    getProcedures: vi.fn(async () => []),
    getServerVersion: vi.fn(async () => `${dialect} 1.0`),
    ...overrides
  }
}

const managers: ConnectionManager[] = []

afterEach(async () => {
  while (managers.length > 0) {
    const m = managers.pop()!
    m.dispose()
    await m.disconnectAll()
  }
  vi.restoreAllMocks()
})

describe('ConnectionManager auto DB disconnection & engine recognition', () => {
  it('auto-disconnects idle connections after configured timeout and emits auto-disconnected event', async () => {
    const manager = new ConnectionManager({ enabled: true, timeoutMs: 60_000, checkIntervalMs: 60_000 })
    managers.push(manager)

    const adapter = createMockAdapter('postgres')
    vi.spyOn(manager as unknown as { createAdapter: (t: ConnectionConfig['type']) => DatabaseAdapter }, 'createAdapter')
      .mockReturnValue(adapter)

    const events: AutoDisconnectEventPayload[] = []
    manager.on('auto-disconnected', (payload: AutoDisconnectEventPayload) => events.push(payload))

    const res = await manager.connect({ id: 'pg-idle', name: 'Prod PG', type: 'postgres', host: 'localhost', port: 5432 })
    expect(res.success).toBe(true)
    expect(manager.isConnected('pg-idle')).toBe(true)

    const now = Date.now()
    manager.touchConnection('pg-idle', now - 30_000)
    expect(await manager.sweepIdleConnections(now)).toHaveLength(0)
    expect(manager.isConnected('pg-idle')).toBe(true)

    // Exceeds 60s idle threshold
    const disconnected = await manager.sweepIdleConnections(now + 40_000)
    expect(disconnected).toHaveLength(1)
    expect(disconnected[0].connectionId).toBe('pg-idle')
    expect(events).toHaveLength(1)
    expect(events[0].reason).toContain('Auto-disconnected')
    expect(manager.isConnected('pg-idle')).toBe(false)
    expect(adapter.disconnect).toHaveBeenCalledTimes(1)
  })

  it('refreshes idle timer when a query runs and never disconnects while a query is in flight', async () => {
    const manager = new ConnectionManager({ enabled: true, timeoutMs: 5_000, checkIntervalMs: 60_000 })
    managers.push(manager)

    let resolveQuery!: () => void
    const pendingQuery = new Promise<void>((resolve) => {
      resolveQuery = resolve
    })

    const adapter = createMockAdapter('postgres', {
      query: vi.fn(async () => {
        await pendingQuery
        return { columns: [], rows: [], rowCount: 0, duration: 10 }
      })
    })
    vi.spyOn(manager as unknown as { createAdapter: (t: ConnectionConfig['type']) => DatabaseAdapter }, 'createAdapter')
      .mockReturnValue(adapter)

    await manager.connect({ id: 'pg-busy', name: 'Busy PG', type: 'postgres', host: 'localhost', port: 5432 })

    const queryPromise = manager.query('pg-busy', 'SELECT 1')
    // Simulate time passing far beyond timeout while query is still executing
    const sweptDuringQuery = await manager.sweepIdleConnections(Date.now() + 120_000)
    expect(sweptDuringQuery).toHaveLength(0)
    expect(manager.isConnected('pg-busy')).toBe(true)

    resolveQuery()
    await queryPromise

    // Immediately after query finishes, idle time was refreshed so it should stay connected
    expect(await manager.sweepIdleConnections(Date.now() + 1_000)).toHaveLength(0)
    expect(manager.isConnected('pg-busy')).toBe(true)

    // After timeout elapses with no activity, it disconnects
    expect(await manager.sweepIdleConnections(Date.now() + 10_000)).toHaveLength(1)
    expect(manager.isConnected('pg-busy')).toBe(false)
  })

  it('keeps connections open when auto-disconnect is disabled', async () => {
    const manager = new ConnectionManager({ enabled: false, timeoutMs: 1_000, checkIntervalMs: 60_000 })
    managers.push(manager)

    const adapter = createMockAdapter('mysql')
    vi.spyOn(manager as unknown as { createAdapter: (t: ConnectionConfig['type']) => DatabaseAdapter }, 'createAdapter')
      .mockReturnValue(adapter)

    await manager.connect({ id: 'my-1', name: 'MySQL', type: 'mysql', host: 'localhost', port: 3306 })
    expect(await manager.sweepIdleConnections(Date.now() + 3_600_000)).toHaveLength(0)
    expect(manager.isConnected('my-1')).toBe(true)
  })

  it('auto-recognizes CockroachDB on a PostgreSQL connection from server version and switches adapter', async () => {
    const manager = new ConnectionManager({ enabled: false, timeoutMs: 60_000 })
    managers.push(manager)

    const pgAdapter = createMockAdapter('postgres', {
      getServerVersion: vi.fn(async () => 'CockroachDB CCL v24.1.2 (x86_64-pc-linux-gnu)')
    })
    const crdbAdapter = createMockAdapter('cockroachdb', {
      getServerVersion: vi.fn(async () => 'CockroachDB CCL v24.1.2 (x86_64-pc-linux-gnu)')
    })

    vi.spyOn(manager as unknown as { createAdapter: (t: ConnectionConfig['type']) => DatabaseAdapter }, 'createAdapter')
      .mockImplementation((t) => (t === 'cockroachdb' ? crdbAdapter : pgAdapter))

    const res = await manager.connect({ id: 'crdb-1', name: 'CRDB', type: 'postgres', host: 'localhost', port: 26257 })
    expect(res.success).toBe(true)
    expect(res.detectedType).toBe('cockroachdb')
    expect(res.resolvedConfig?.type).toBe('cockroachdb')
    expect(manager.getConnectionDialect('crdb-1')).toBe('cockroachdb')
    expect(pgAdapter.disconnect).toHaveBeenCalledTimes(1)
    expect(crdbAdapter.connect).toHaveBeenCalledTimes(1)
  })

  it('auto-recognizes engine from connection URI scheme before connecting', async () => {
    const manager = new ConnectionManager({ enabled: false, timeoutMs: 60_000 })
    managers.push(manager)

    const redisAdapter = createMockAdapter('redis')
    const createSpy = vi
      .spyOn(manager as unknown as { createAdapter: (t: ConnectionConfig['type']) => DatabaseAdapter }, 'createAdapter')
      .mockReturnValue(redisAdapter)

    const res = await manager.connect({
      id: 'uri-1',
      name: 'Auto URI',
      type: 'postgres', // wrong initial type selected by user
      connectionUri: 'redis://localhost:6379/0'
    })
    expect(res.success).toBe(true)
    expect(createSpy).toHaveBeenCalledWith('redis')
    expect(res.detectedType).toBe('redis')
    expect(res.resolvedConfig?.type).toBe('redis')
  })
})
