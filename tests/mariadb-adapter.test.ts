import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MariaDBAdapter } from '../src/main/db/adapters/mariadb'

describe('MariaDBAdapter Integration Test', () => {
  let adapter: MariaDBAdapter

  beforeEach(async () => {
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

  afterEach(async () => {
    if (adapter && adapter.isConnected()) {
      await adapter.disconnect()
    }
  })

  it('should connect and query version', async () => {
    const version = await adapter.getServerVersion()
    expect(version).toContain('MariaDB')
  })

  it('should execute a simple query successfully', async () => {
    const result = await adapter.query('SELECT 1 + 1 AS result')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].result).toBe(2)
    expect(result.columns).toHaveLength(1)
    expect(result.columns[0].name).toBe('result')
  })

  it('should execute a parameterized query', async () => {
    const result = await adapter.query('SELECT ? + ? AS sum', [10, 20])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].sum).toBe(30)
  })

  it('should get tables', async () => {
    const tables = await adapter.getTables('mysql')
    expect(tables.length).toBeGreaterThan(0)
    expect(tables[0].name).toBeDefined()
  })
})
