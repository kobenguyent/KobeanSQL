import { describe, it, expect } from 'vitest'
import { DB_COLORS, DB_DEFAULT_PORTS } from '../src/renderer/src/types'

describe('DB_COLORS', () => {
  it('has a color for every supported database type', () => {
    const types = ['mysql', 'mariadb', 'postgres', 'sqlite', 'mssql', 'mongodb'] as const
    for (const type of types) {
      expect(DB_COLORS[type]).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

describe('DB_DEFAULT_PORTS', () => {
  it('returns correct default port for MySQL', () => {
    expect(DB_DEFAULT_PORTS['mysql']).toBe(3306)
  })

  it('returns correct default port for MariaDB', () => {
    expect(DB_DEFAULT_PORTS['mariadb']).toBe(3306)
  })

  it('returns correct default port for PostgreSQL', () => {
    expect(DB_DEFAULT_PORTS['postgres']).toBe(5432)
  })

  it('returns undefined for SQLite (file-based, no port)', () => {
    expect(DB_DEFAULT_PORTS['sqlite']).toBeUndefined()
  })

  it('returns correct default port for SQL Server', () => {
    expect(DB_DEFAULT_PORTS['mssql']).toBe(1433)
  })

  it('returns correct default port for MongoDB', () => {
    expect(DB_DEFAULT_PORTS['mongodb']).toBe(27017)
  })
})
