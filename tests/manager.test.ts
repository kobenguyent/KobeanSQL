import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionManager } from '../src/main/db/manager'

// Mock electron-log so it doesn't break in test environment
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  info: vi.fn(),
  error: vi.fn()
}))

// Mock the individual adapters so we don't need real DB connections
vi.mock('../src/main/db/adapters/mysql', () => ({
  MySQLAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['testdb'] }
    async getTables() { return [{ name: 'users', type: 'table' }] }
    async getColumns() { return [] }
    async getProcedures() { return [{ name: 'sp_test', schema: 'testdb', type: 'procedure' }] }
    async ping() { return true }
  }
}))

vi.mock('../src/main/db/adapters/postgres', () => ({
  PostgresAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['postgres'] }
    async getTables() { return [] }
    async getColumns() { return [] }
    async getProcedures() { return [{ name: 'my_func', schema: 'public', type: 'function', specificName: 'my_func_12345' }] }
    async ping() { return true }
  }
}))

vi.mock('../src/main/db/adapters/sqlite', () => ({
  SQLiteAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['main'] }
    async getTables() { return [] }
    async getColumns() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
  }
}))

vi.mock('../src/main/db/adapters/mssql', () => ({
  MSSQLAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['master'] }
    async getTables() { return [] }
    async getColumns() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
  }
}))

vi.mock('../src/main/db/adapters/mongodb', () => ({
  MongoDBAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [{ name: 'name', type: 'string' }], rows: [{ name: 'Ada' }], rowCount: 1, duration: 1 } }
    async getDatabases() { return ['admin', 'app'] }
    async getTables() { return [{ name: 'users', type: 'table' }] }
    async getColumns() { return [{ name: '_id', type: 'object', nullable: false, primaryKey: true }] }
    async getForeignKeys() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
    async getServerVersion() { return 'MongoDB 7.0.4' }
  }
}))

vi.mock('../src/main/db/adapters/cockroachdb', () => ({
  CockroachDBAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['defaultdb'] }
    async getTables() { return [] }
    async getColumns() { return [] }
    async getForeignKeys() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
    async getServerVersion() { return 'CockroachDB v23.2.0' }
  }
}))

vi.mock('../src/main/db/adapters/clickhouse', () => ({
  ClickHouseAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['default', 'system'] }
    async getTables() { return [{ name: 'events', type: 'table' }] }
    async getColumns() { return [] }
    async getForeignKeys() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
    async getServerVersion() { return '24.1.0' }
  }
}))

vi.mock('../src/main/db/adapters/cassandra', () => ({
  CassandraAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['my_keyspace'] }
    async getTables() { return [{ name: 'users', type: 'table' }] }
    async getColumns() { return [] }
    async getForeignKeys() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
    async getServerVersion() { return 'Cassandra 4.1.3' }
  }
}))

vi.mock('../src/main/db/adapters/redis', () => ({
  RedisAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [{ name: 'result', type: 'string' }], rows: [{ result: 'PONG' }], rowCount: 1, duration: 1 } }
    async getDatabases() { return Array.from({ length: 16 }, (_, i) => String(i)) }
    async getTables() { return [{ name: 'mykey', type: 'table' }] }
    async getColumns() { return [{ name: 'value', type: 'string', nullable: true, primaryKey: false }] }
    async getForeignKeys() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
    async getServerVersion() { return 'Redis 7.2.0' }
  }
}))

vi.mock('../src/main/db/adapters/elasticsearch', () => ({
  ElasticsearchAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['default'] }
    async getTables() { return [{ name: 'my-index', type: 'table' }] }
    async getColumns() { return [] }
    async getForeignKeys() { return [] }
    async getProcedures() { return [] }
    async ping() { return true }
    async getServerVersion() { return 'Elasticsearch 8.12.0' }
  }
}))

vi.mock('../src/main/db/adapters/oracle', () => ({
  OracleAdapter: class {
    async connect() {}
    async disconnect() {}
    isConnected() { return true }
    async query() { return { columns: [], rows: [], rowCount: 0, duration: 1 } }
    async getDatabases() { return ['ORCL'] }
    async getTables() { return [{ name: 'EMPLOYEES', type: 'table' }] }
    async getColumns() { return [] }
    async getForeignKeys() { return [] }
    async getProcedures() { return [{ name: 'GET_EMPLOYEE', schema: 'HR', type: 'procedure' }] }
    async ping() { return true }
    async getServerVersion() { return 'Oracle Database 19c' }
  }
}))

describe('ConnectionManager', () => {
  let manager: ConnectionManager

  beforeEach(() => {
    manager = new ConnectionManager()
  })

  it('starts with no active connections', () => {
    expect(manager.isConnected('any-id')).toBe(false)
  })

  it('connects successfully and marks connection as active', async () => {
    const config = {
      id: 'conn-1',
      name: 'Test MySQL',
      type: 'mysql' as const,
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'test'
    }
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('conn-1')).toBe(true)
  })

  it('disconnects and removes connection', async () => {
    const config = {
      id: 'conn-2',
      name: 'Test PG',
      type: 'postgres' as const,
      host: 'localhost',
      port: 5432
    }
    await manager.connect(config)
    expect(manager.isConnected('conn-2')).toBe(true)
    await manager.disconnect('conn-2')
    expect(manager.isConnected('conn-2')).toBe(false)
  })

  it('queries a connected database', async () => {
    const config = {
      id: 'conn-3',
      name: 'Test SQLite',
      type: 'sqlite' as const,
      filename: ':memory:'
    }
    await manager.connect(config)
    const result = await manager.query('conn-3', 'SELECT 1')
    expect(result).toHaveProperty('rows')
    expect(result).toHaveProperty('columns')
    expect(result).toHaveProperty('duration')
  })

  it('throws when querying a non-connected ID', async () => {
    await expect(manager.query('no-such-id', 'SELECT 1')).rejects.toThrow('Not connected')
  })

  it('getDatabases returns list for connected ID', async () => {
    const config = {
      id: 'conn-4',
      name: 'Test MySQL2',
      type: 'mysql' as const,
      host: 'localhost'
    }
    await manager.connect(config)
    const dbs = await manager.getDatabases('conn-4')
    expect(Array.isArray(dbs)).toBe(true)
    expect(dbs).toContain('testdb')
  })

  it('disconnectAll clears all connections', async () => {
    const ids = ['a', 'b', 'c']
    for (const id of ids) {
      await manager.connect({ id, name: id, type: 'mysql' as const })
    }
    for (const id of ids) {
      expect(manager.isConnected(id)).toBe(true)
    }
    await manager.disconnectAll()
    for (const id of ids) {
      expect(manager.isConnected(id)).toBe(false)
    }
  })

  it('testConnection does not leave a persistent connection', async () => {
    const config = {
      id: 'test-only',
      name: 'Test',
      type: 'postgres' as const,
      host: 'localhost'
    }
    const result = await manager.testConnection(config)
    expect(result.success).toBe(true)
    // Should NOT have created a permanent connection entry
    expect(manager.isConnected('test-only')).toBe(false)
  })

  it('re-connects if already connected (replaces old connection)', async () => {
    const config = { id: 'conn-5', name: 'Dup', type: 'mysql' as const }
    await manager.connect(config)
    // Connect again — should not throw, should replace
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('conn-5')).toBe(true)
  })

  it('getProcedures returns list for connected ID', async () => {
    const config = {
      id: 'conn-6',
      name: 'Test MySQL Procedures',
      type: 'mysql' as const,
      host: 'localhost'
    }
    await manager.connect(config)
    const procs = await manager.getProcedures('conn-6')
    expect(Array.isArray(procs)).toBe(true)
    expect(procs.length).toBeGreaterThan(0)
    expect(procs[0]).toHaveProperty('name')
    expect(procs[0]).toHaveProperty('type')
  })

  it('getProcedures throws when not connected', async () => {
    await expect(manager.getProcedures('no-such-id')).rejects.toThrow('Not connected')
  })

  it('getProcedures returns empty array for SQLite', async () => {
    const config = {
      id: 'conn-7',
      name: 'Test SQLite Procedures',
      type: 'sqlite' as const,
      filename: ':memory:'
    }
    await manager.connect(config)
    const procs = await manager.getProcedures('conn-7')
    expect(Array.isArray(procs)).toBe(true)
    expect(procs).toHaveLength(0)
  })

  it('getProcedures returns specificName for Postgres routines', async () => {
    const config = {
      id: 'conn-8',
      name: 'Test PG Procedures',
      type: 'postgres' as const,
      host: 'localhost'
    }
    await manager.connect(config)
    const procs = await manager.getProcedures('conn-8')
    expect(Array.isArray(procs)).toBe(true)
    expect(procs.length).toBeGreaterThan(0)
    expect(procs[0]).toHaveProperty('specificName')
    expect(procs[0].specificName).toBe('my_func_12345')
  })

  it('connects and queries MongoDB through the adapter', async () => {
    const config = {
      id: 'mongo-1',
      name: 'Mongo App',
      type: 'mongodb' as const,
      host: 'localhost',
      port: 27017,
      database: 'app'
    }

    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('mongo-1')).toBe(true)
    await expect(manager.getDatabases('mongo-1')).resolves.toEqual(['admin', 'app'])
    await expect(manager.query('mongo-1', 'db.users.find({})')).resolves.toMatchObject({
      rowCount: 1,
      rows: [{ name: 'Ada' }]
    })
  })

  it('isConnected delegates to adapter.isConnected()', async () => {
    const config = { id: 'conn-9', name: 'Test', type: 'mysql' as const }
    await manager.connect(config)
    // Adapter mock returns true by default
    expect(manager.isConnected('conn-9')).toBe(true)
  })

  it('isConnected cleans up stale connection and emits connection-lost when adapter reports disconnected', async () => {
    // Use a custom module mock with controllable isConnected state
    let adapterConnected = true
    const { MySQLAdapter } = await import('../src/main/db/adapters/mysql')
    // Override the prototype temporarily so the newly created adapter uses our state
    const originalIsConnected = MySQLAdapter.prototype.isConnected
    try {
      MySQLAdapter.prototype.isConnected = () => adapterConnected

      const config = { id: 'conn-lost', name: 'Stale', type: 'mysql' as const }
      await manager.connect(config)
      expect(manager.isConnected('conn-lost')).toBe(true)

      // Simulate pool closing unexpectedly
      adapterConnected = false

      const lostIds: string[] = []
      manager.on('connection-lost', (id: string) => lostIds.push(id))

      expect(manager.isConnected('conn-lost')).toBe(false)
      expect(lostIds).toContain('conn-lost')
      // Stale entry should have been removed; second call must NOT re-emit
      expect(manager.isConnected('conn-lost')).toBe(false)
      expect(lostIds).toHaveLength(1)
    } finally {
      // Restore original prototype method
      MySQLAdapter.prototype.isConnected = originalIsConnected
    }
  })
  it('connects to CockroachDB through the adapter', async () => {
    const config = {
      id: 'crdb-1',
      name: 'CockroachDB Local',
      type: 'cockroachdb' as const,
      host: 'localhost',
      port: 26257,
      database: 'defaultdb'
    }
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('crdb-1')).toBe(true)
    await expect(manager.getDatabases('crdb-1')).resolves.toContain('defaultdb')
    await expect(manager.getServerVersion('crdb-1')).resolves.toMatch(/CockroachDB/)
  })

  it('connects to ClickHouse through the adapter', async () => {
    const config = {
      id: 'ch-1',
      name: 'ClickHouse Local',
      type: 'clickhouse' as const,
      host: 'localhost',
      port: 8123,
      database: 'default'
    }
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('ch-1')).toBe(true)
    await expect(manager.getDatabases('ch-1')).resolves.toContain('default')
    await expect(manager.getTables('ch-1')).resolves.toHaveLength(1)
  })

  it('connects to Cassandra through the adapter', async () => {
    const config = {
      id: 'cass-1',
      name: 'Cassandra Local',
      type: 'cassandra' as const,
      host: 'localhost',
      port: 9042,
      database: 'my_keyspace'
    }
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('cass-1')).toBe(true)
    await expect(manager.getDatabases('cass-1')).resolves.toContain('my_keyspace')
    await expect(manager.getProcedures('cass-1')).resolves.toHaveLength(0)
  })

  it('connects to Redis through the adapter', async () => {
    const config = {
      id: 'redis-1',
      name: 'Redis Local',
      type: 'redis' as const,
      host: 'localhost',
      port: 6379
    }
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('redis-1')).toBe(true)
    const dbs = await manager.getDatabases('redis-1')
    expect(dbs).toHaveLength(16)
    expect(dbs[0]).toBe('0')
    await expect(manager.query('redis-1', 'PING')).resolves.toMatchObject({ rowCount: 1 })
  })

  it('connects to Elasticsearch through the adapter', async () => {
    const config = {
      id: 'es-1',
      name: 'Elasticsearch Local',
      type: 'elasticsearch' as const,
      host: 'localhost',
      port: 9200
    }
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('es-1')).toBe(true)
    await expect(manager.getDatabases('es-1')).resolves.toEqual(['default'])
    await expect(manager.getTables('es-1')).resolves.toHaveLength(1)
  })

  it('connects to Oracle through the adapter', async () => {
    const config = {
      id: 'ora-1',
      name: 'Oracle Local',
      type: 'oracle' as const,
      host: 'localhost',
      port: 1521,
      database: 'ORCL',
      user: 'HR',
      password: 'secret'
    }
    const result = await manager.connect(config)
    expect(result.success).toBe(true)
    expect(manager.isConnected('ora-1')).toBe(true)
    await expect(manager.getDatabases('ora-1')).resolves.toContain('ORCL')
    const procs = await manager.getProcedures('ora-1')
    expect(procs).toHaveLength(1)
    expect(procs[0].name).toBe('GET_EMPLOYEE')
    expect(procs[0].type).toBe('procedure')
    await expect(manager.getServerVersion('ora-1')).resolves.toMatch(/Oracle/)
  })
})
