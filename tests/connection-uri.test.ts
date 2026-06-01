import { describe, expect, it } from 'vitest'
import { parseConnectionUri, resolveConnectionConfig } from '../src/main/db/connection-uri'
import type { ConnectionConfig } from '../src/main/db/types'

describe('connection URI parsing', () => {
  it('parses postgres URI', () => {
    const parsed = parseConnectionUri('postgres', 'postgresql://alice:secret@db.local:5433/app_db?sslmode=require')

    expect(parsed).toEqual({
      host: 'db.local',
      port: 5433,
      user: 'alice',
      password: 'secret',
      database: 'app_db',
      ssl: true
    })
  })

  it('parses mysql URI', () => {
    const parsed = parseConnectionUri('mysql', 'mysql://root:pass@127.0.0.1:3307/test_db')

    expect(parsed).toEqual({
      host: '127.0.0.1',
      port: 3307,
      user: 'root',
      password: 'pass',
      database: 'test_db'
    })
  })

  it('parses mssql URI and encrypt flag', () => {
    const parsed = parseConnectionUri('mssql', 'mssql://sa:pass@localhost:1433/master?encrypt=true')

    expect(parsed).toEqual({
      host: 'localhost',
      port: 1433,
      user: 'sa',
      password: 'pass',
      database: 'master',
      ssl: true
    })
  })

  it('parses mongodb URI', () => {
    const parsed = parseConnectionUri('mongodb', 'mongodb://root:pass@localhost:27017/app?ssl=true') // betterleaks:allow - test fixture

    expect(parsed).toEqual({
      host: 'localhost',
      port: 27017,
      user: 'root',
      password: 'pass',
      database: 'app',
      ssl: true
    })
  })

  it('parses mongodb+srv URI', () => {
    const parsed = parseConnectionUri('mongodb', 'mongodb+srv://alice:secret@cluster.example.com/app') // betterleaks:allow - test fixture

    expect(parsed).toEqual({
      host: 'cluster.example.com',
      port: undefined,
      user: 'alice',
      password: 'secret',
      database: 'app'
    })
  })

  it('throws on invalid scheme for type', () => {
    expect(() => parseConnectionUri('postgres', 'mysql://root:pass@localhost:3306/db')).toThrow(
      'Invalid URI scheme for postgres'
    )
  })

  it('resolves URI values over manual fields', () => {
    const config: ConnectionConfig = {
      id: '1',
      name: 'PG',
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      user: 'local',
      password: 'local',
      database: 'localdb',
      connectionUri: 'postgresql://remote:pw@db.example.com:5439/prod'
    }

    const resolved = resolveConnectionConfig(config)

    expect(resolved.host).toBe('db.example.com')
    expect(resolved.port).toBe(5439)
    expect(resolved.user).toBe('remote')
    expect(resolved.password).toBe('pw')
    expect(resolved.database).toBe('prod')
  })
})
