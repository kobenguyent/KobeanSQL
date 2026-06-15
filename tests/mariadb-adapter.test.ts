import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MariaDBAdapter } from '../src/main/db/adapters/mariadb'

const mockQuery = vi.fn()
const mockPing = vi.fn()
const mockRelease = vi.fn()
const mockRollback = vi.fn()
const mockEnd = vi.fn()
const mockGetConnection = vi.fn()

const mockConnection = {
  ping: mockPing,
  release: mockRelease,
  rollback: mockRollback,
  query: mockQuery
}

const mockPoolInstance = {
  getConnection: mockGetConnection,
  end: mockEnd
}

vi.mock('mariadb', () => ({
  default: {
    createPool: vi.fn().mockImplementation(() => mockPoolInstance)
  }
}))

vi.mock('../src/main/db/connection-uri', () => ({
  resolveConnectionConfig: (config: unknown) => config
}))

describe('MariaDBAdapter', () => {
  let adapter: MariaDBAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetConnection.mockResolvedValue(mockConnection)
    mockPing.mockResolvedValue(undefined)
    mockEnd.mockResolvedValue(undefined)
    
    adapter = new MariaDBAdapter()
    await adapter.connect({
      id: 'mariadb-test',
      name: 'MariaDB Test',
      type: 'mariadb',
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'my-secret-pw',
      database: 'mysql'
    })
  })

  it('should connect and query version', async () => {
    const mockRows = [{ version: '10.5.23-MariaDB' }]
    Object.defineProperty(mockRows, 'meta', {
      value: [{ name: () => 'version', type: 'VARCHAR' }],
      enumerable: false
    })
    mockQuery.mockResolvedValue(mockRows)

    const version = await adapter.getServerVersion()
    expect(version).toContain('10.5.23-MariaDB')
  })

  it('should execute a simple query successfully and resolve column name as function', async () => {
    const mockRows = [{ result: 2 }]
    Object.defineProperty(mockRows, 'meta', {
      value: [{ name: () => 'result', type: 'INT' }],
      enumerable: false
    })
    mockQuery.mockResolvedValue(mockRows)

    const result = await adapter.query('SELECT 1 + 1 AS result')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].result).toBe(2)
    expect(result.columns).toHaveLength(1)
    expect(result.columns[0].name).toBe('result')
  })

  it('should execute a query returning string column names (fallback/compatibility)', async () => {
    const mockRows = [{ val: 42 }]
    Object.defineProperty(mockRows, 'meta', {
      value: [{ name: 'val', type: 'INT' }],
      enumerable: false
    })
    mockQuery.mockResolvedValue(mockRows)

    const result = await adapter.query('SELECT 42 AS val')
    expect(result.columns[0].name).toBe('val')
  })

  it('should get tables', async () => {
    const mockRows = [
      { TABLE_NAME: 'users', TABLE_TYPE: 'BASE TABLE', TABLE_ROWS: 100, ENGINE: 'InnoDB' },
      { TABLE_NAME: 'views', TABLE_TYPE: 'VIEW', TABLE_ROWS: null, ENGINE: null }
    ]
    Object.defineProperty(mockRows, 'meta', {
      value: [
        { name: () => 'TABLE_NAME', type: 'VARCHAR' },
        { name: () => 'TABLE_TYPE', type: 'VARCHAR' },
        { name: () => 'TABLE_ROWS', type: 'INT' },
        { name: () => 'ENGINE', type: 'VARCHAR' }
      ],
      enumerable: false
    })
    mockQuery.mockResolvedValue(mockRows)

    const tables = await adapter.getTables('mysql')
    expect(tables).toHaveLength(2)
    expect(tables[0]).toEqual({ name: 'users', type: 'table', rowCount: 100, engine: 'InnoDB' })
    expect(tables[1]).toEqual({ name: 'views', type: 'view', rowCount: undefined, engine: undefined })
  })
})
