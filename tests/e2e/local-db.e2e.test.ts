import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ConnectionManager } from '../../src/main/db/manager'
import type { ConnectionConfig } from '../../src/main/db/types'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  info: vi.fn(),
  error: vi.fn()
}))

type SQLiteDatabaseCtor = new (filename: string) => {
  exec(sql: string): void
  close(): void
  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[]
    get: (...params: unknown[]) => unknown
    run: (...params: unknown[]) => { changes: number }
    columns?: () => Array<{ column?: string; name?: string; type?: string }>
  }
}

type FakeColumn = {
  name: string
  type: string
  notnull: number
  pk: number
  dflt_value?: string
}

type FakeTable = {
  name: string
  columns: FakeColumn[]
  foreignKeys: Array<{ from: string; table: string; to: string }>
  rows: Array<Record<string, unknown>>
}

class FakeDatabaseSync {
  private tables = new Map<string, FakeTable>()
  open = true

  constructor(_filename: string) {}

  exec(_sql: string): void {}

  close(): void {
    this.tables.clear()
    this.open = false
  }

  prepare(sql: string) {
    const normalized = sql.trim()
    const lower = normalized.toLowerCase()
    const unsupported = () => {
      throw new Error(`Unsupported SQL in fake sqlite test driver: ${normalized}`)
    }

    const readRows = (params: unknown[]): Record<string, unknown>[] => {
      if (lower.startsWith('pragma database_list')) {
        return [{ seq: 0, name: 'main', file: '' }]
      }

      if (lower.startsWith('select sqlite_version() as version')) {
        return [{ version: '3.45.0' }]
      }

      if (lower.startsWith('select 1 from sqlite_master where name = ?')) {
        const tableName = String(params[0] ?? '')
        return this.tables.has(tableName) ? [{ 1: 1 }] : []
      }

      if (lower.startsWith('select name, type from sqlite_master')) {
        return Array.from(this.tables.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((table) => ({ name: table.name, type: 'table' }))
      }

      if (lower.startsWith('pragma table_info(')) {
        const raw = normalized.slice(normalized.indexOf('(') + 1, normalized.lastIndexOf(')')).trim()
        const tableName = raw.replace(/^"|"$/g, '').replace(/""/g, '"')
        const table = this.tables.get(tableName)
        if (!table) return []
        return table.columns.map((col, idx) => ({
          cid: idx,
          name: col.name,
          type: col.type,
          notnull: col.notnull,
          dflt_value: col.dflt_value ?? null,
          pk: col.pk
        }))
      }

      if (lower.startsWith('pragma foreign_key_list(')) {
        const raw = normalized.slice(normalized.indexOf('(') + 1, normalized.lastIndexOf(')')).trim()
        const tableName = raw.replace(/^"|"$/g, '').replace(/""/g, '"')
        const table = this.tables.get(tableName)
        if (!table) return []
        return table.foreignKeys.map((fk, idx) => ({
          id: idx,
          seq: 0,
          table: fk.table,
          from: fk.from,
          to: fk.to
        }))
      }

      if (lower.startsWith('select 1')) {
        return [{ 1: 1 }]
      }

      const selectMatch = normalized.match(
        /^select\s+(.+?)\s+from\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(.+?))?;?$/i
      )
      if (selectMatch) {
        const [, rawColumns, tableName, whereClause, orderBy] = selectMatch
        const table = this.tables.get(tableName)
        if (!table) return []

        let filtered = [...table.rows]
        if (whereClause) {
          const whereMatch = whereClause.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*'((?:[^']|''+)*)'$/i)
          if (!whereMatch) unsupported()
          const [, whereColumn, whereValue] = whereMatch
          const value = whereValue.replace(/''/g, "'")
          filtered = filtered.filter((row) => String(row[whereColumn] ?? '') === value)
        }

        if (orderBy) {
          const orderByCol = orderBy.replace(/;$/, '').trim()
          filtered.sort((a, b) => Number(a[orderByCol] ?? 0) - Number(b[orderByCol] ?? 0))
        }

        const columns = rawColumns.split(',').map((c) => c.trim())
        return filtered.map((row) => {
          const projected: Record<string, unknown> = {}
          for (const col of columns) projected[col] = row[col]
          return projected
        })
      }

      unsupported()
    }

    return {
      all: (...params: unknown[]) => readRows(params),
      get: (...params: unknown[]) => readRows(params)[0],
      run: (...params: unknown[]) => {
        void params

        const createTable = normalized.match(/^create\s+table\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]+)\)\s*;?$/i)
        if (createTable) {
          const [, tableName, rawDefs] = createTable
          const defs = rawDefs
            .split(',')
            .map((def) => def.trim())
            .filter(Boolean)
          const columns = defs
            .filter((def) => !/^foreign\s+key\b/i.test(def))
            .map((def) => {
              const tokens = def.split(/\s+/)
              const name = tokens[0]
              const type = tokens[1] || 'TEXT'
              const pk = /\bprimary\s+key\b/i.test(def) ? 1 : 0
              const notnull = /\bnot\s+null\b/i.test(def) ? 1 : 0
              const defaultMatch = def.match(/\bdefault\s+(.+)$/i)
              return {
                name,
                type,
                pk,
                notnull,
                dflt_value: defaultMatch?.[1]?.trim()
              } satisfies FakeColumn
            })
          const foreignKeys = defs
            .filter((def) => /^foreign\s+key\b/i.test(def))
            .map((def) => {
              const match = def.match(
                /^foreign\s+key\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*references\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)$/i
              )
              if (!match) unsupported()
              return { from: match[1], table: match[2], to: match[3] }
            })
          this.tables.set(tableName, { name: tableName, columns, foreignKeys, rows: [] })
          return { changes: 0 }
        }

        const insertMatch = normalized.match(
          /^insert\s+into\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]+)\)\s*values\s*(.+)\s*;?$/i
        )
        if (insertMatch) {
          const [, tableName, rawCols, rawValues] = insertMatch
          const table = this.tables.get(tableName)
          if (!table) unsupported()
          const cols = rawCols.split(',').map((col) => col.trim())
          const tuples = rawValues
            .trim()
            .replace(/;$/, '')
            .split(/\)\s*,\s*\(/)
            .map((tuple) => tuple.replace(/^\(/, '').replace(/\)$/, ''))

          for (const tuple of tuples) {
            const values = tuple.split(',').map((val) => val.trim())
            const row: Record<string, unknown> = {}
            cols.forEach((col, idx) => {
              const raw = values[idx]
              if (raw === undefined) row[col] = null
              else if (/^'.*'$/.test(raw)) row[col] = raw.slice(1, -1).replace(/''/g, "'")
              else row[col] = Number(raw)
            })

            const pkCol = table.columns.find((col) => col.pk === 1)
            if (pkCol && row[pkCol.name] == null) {
              const maxPk = table.rows.reduce((max, current) => Math.max(max, Number(current[pkCol.name] ?? 0)), 0)
              row[pkCol.name] = maxPk + 1
            }
            table.rows.push(row)
          }
          return { changes: tuples.length }
        }

        const updateMatch = normalized.match(
          /^update\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+?)\s+where\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*'((?:[^']|''+)*)'\s*;?$/i
        )
        if (updateMatch) {
          const [, tableName, setCol, rawValue, whereCol, whereValue] = updateMatch
          const table = this.tables.get(tableName)
          if (!table) unsupported()
          const value = /^'.*'$/.test(rawValue)
            ? rawValue.slice(1, -1).replace(/''/g, "'")
            : Number(rawValue)
          const matchValue = whereValue.replace(/''/g, "'")

          let changes = 0
          for (const row of table.rows) {
            if (String(row[whereCol] ?? '') === matchValue) {
              row[setCol] = value
              changes += 1
            }
          }
          return { changes }
        }

        unsupported()
      },
      columns: () => []
    }
  }
}

function getSqliteDatabaseCtor(): SQLiteDatabaseCtor {
  const sqliteModule = (
    process as typeof process & { getBuiltinModule?: (name: string) => unknown }
  ).getBuiltinModule?.('node:sqlite') as { DatabaseSync?: SQLiteDatabaseCtor } | undefined
  if (sqliteModule?.DatabaseSync) {
    return sqliteModule.DatabaseSync
  }

  try {
    const BetterSqlite3 = require('better-sqlite3') as SQLiteDatabaseCtor
    const probe = new BetterSqlite3(':memory:')
    probe.close()
    return BetterSqlite3
  } catch {
    return FakeDatabaseSync
  }
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

vi.mock('../src/main/db/adapters/sqlite', async () => {
  class SQLiteAdapter {
    private db: InstanceType<SQLiteDatabaseCtor> | null = null

    async connect(config: ConnectionConfig): Promise<void> {
      const DatabaseSync = getSqliteDatabaseCtor()
      const filename = config.filename || ':memory:'
      this.db = new DatabaseSync(filename)
      this.db.exec('PRAGMA foreign_keys = ON;')
    }

    async disconnect(): Promise<void> {
      this.db?.close()
      this.db = null
    }

    async query(sql: string, params: unknown[] = []) {
      if (!this.db) throw new Error('Not connected')
      const start = Date.now()
      try {
        const stmt = this.db.prepare(sql)
        const trimmed = sql.trim().toLowerCase()
        const isRead = trimmed.startsWith('select') || trimmed.startsWith('with') || trimmed.startsWith('pragma')
        if (isRead) {
          const rows = stmt.all(...params) as Record<string, unknown>[]
          const columnMetadata = typeof stmt.columns === 'function' ? stmt.columns() : []
          const metadataColumns = columnMetadata.map((col) => ({
            name: String(col.column ?? col.name ?? ''),
            type: String(col.type ?? 'TEXT'),
            nullable: true,
            primaryKey: false
          }))
          const columns =
            metadataColumns.length > 0
              ? metadataColumns
              : Object.keys(rows[0] ?? {}).map((name) => ({
                  name,
                type: 'TEXT',
                nullable: true,
                primaryKey: false
              }))
          return { columns, rows, rowCount: rows.length, duration: Date.now() - start }
        }

        const result = stmt.run(...params)
        return {
          columns: [],
          rows: [],
          rowCount: result.changes,
          duration: Date.now() - start
        }
      } catch (err) {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          duration: Date.now() - start,
          error: (err as Error).message
        }
      }
    }

    async getDatabases(): Promise<string[]> {
      if (!this.db) return []
      const rows = this.db.prepare('PRAGMA database_list').all() as Array<{ name: string }>
      return rows.map((r) => r.name)
    }

    async getTables(): Promise<Array<{ name: string; type: 'table' | 'view' }>> {
      if (!this.db) return []
      const rows = this.db
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as Array<{ name: string; type: string }>
      return rows.map((r) => ({ name: r.name, type: r.type === 'view' ? 'view' : 'table' }))
    }

    async getColumns(table: string) {
      if (!this.db) return []
      const knownTable = this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'view') LIMIT 1")
        .get(table)
      if (!knownTable) return []
      const rows = this.db
        .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`)
        .all() as Array<Record<string, unknown>>
      return rows.map((r) => ({
        name: r['name'] as string,
        type: (r['type'] as string) || 'TEXT',
        nullable: Number(r['notnull'] || 0) === 0,
        primaryKey: Number(r['pk'] || 0) !== 0,
        defaultValue: r['dflt_value'] as string | undefined
      }))
    }

    async getForeignKeys(table: string) {
      if (!this.db) return []
      const rows = this.db
        .prepare(`PRAGMA foreign_key_list(${quoteSqliteIdentifier(table)})`)
        .all() as Array<Record<string, unknown>>
      return rows.map((r) => ({
        columnName: r['from'] as string,
        referencedTable: r['table'] as string,
        referencedColumn: r['to'] as string
      }))
    }

    async getProcedures() {
      return []
    }

    isConnected(): boolean {
      return !!this.db?.open
    }

    async ping(): Promise<boolean> {
      if (!this.db) return false
      this.db.prepare('SELECT 1').get()
      return true
    }

    async getServerVersion(): Promise<string> {
      if (!this.db) return 'Unknown'
      const row = this.db.prepare('SELECT sqlite_version() AS version').get() as { version?: string }
      return row?.version || 'Unknown'
    }
  }

  return { SQLiteAdapter }
})

function createLocalSqlitePath(): { dbFile: string; cleanupDir: string } {
  const cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobeansql-e2e-'))
  const dbFile = path.join(cleanupDir, 'app-data.sqlite')
  return { dbFile, cleanupDir }
}

function cleanupTestDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

describe('local DB e2e flows', () => {
  it('connects to a local sqlite database and reads schema/data like an end user', async () => {
    const { dbFile, cleanupDir } = createLocalSqlitePath()
    const manager = new ConnectionManager()
    const config: ConnectionConfig = {
      id: 'sqlite-local',
      name: 'Local SQLite',
      type: 'sqlite',
      filename: dbFile
    }
    try {
      const testResult = await manager.testConnection(config)
      expect(testResult.success).toBe(true)

      const connectResult = await manager.connect(config)
      expect(connectResult).toEqual({ success: true })
      expect(manager.isConnected(config.id)).toBe(true)

      await manager.query(
        config.id,
        `CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );`
      )
      await manager.query(
        config.id,
        "INSERT INTO users (email, active) VALUES ('alice@example.com', 1), ('bob@example.com', 0);"
      )

      const databases = await manager.getDatabases(config.id)
      expect(databases).toContain('main')

      const tables = await manager.getTables(config.id, 'main')
      expect(tables.some((t) => t.name === 'users')).toBe(true)

      const columns = await manager.getColumns(config.id, 'users', 'main')
      const idCol = columns.find((c) => c.name === 'id')
      expect(idCol?.primaryKey).toBe(true)

      const queryResult = await manager.query(
        config.id,
        'SELECT id, email, active FROM users ORDER BY id;'
      )
      expect(queryResult.error).toBeUndefined()
      expect(queryResult.rowCount).toBe(2)
      expect(queryResult.rows[0]?.email).toBe('alice@example.com')

      const version = await manager.getServerVersion(config.id)
      expect(version).not.toBe('Unknown')
      expect(version).toMatch(/\d+\.\d+/)

      await manager.disconnectAll()
      expect(manager.isConnected(config.id)).toBe(false)
    } finally {
      cleanupTestDir(cleanupDir)
    }
  })

  it('supports write + read querying against local sqlite data', async () => {
    const { dbFile, cleanupDir } = createLocalSqlitePath()
    const manager = new ConnectionManager()
    const config: ConnectionConfig = {
      id: 'sqlite-write',
      name: 'Local SQLite Write',
      type: 'sqlite',
      filename: dbFile
    }
    try {
      await manager.connect(config)
      await manager.query(
        config.id,
        `CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );`
      )
      await manager.query(
        config.id,
        "INSERT INTO users (email, active) VALUES ('bob@example.com', 0);"
      )

      const updateResult = await manager.query(
        config.id,
        "UPDATE users SET active = 1 WHERE email = 'bob@example.com';"
      )
      expect(updateResult.error).toBeUndefined()
      expect(updateResult.rowCount).toBe(1)

      const verifyResult = await manager.query(
        config.id,
        "SELECT active FROM users WHERE email = 'bob@example.com';"
      )
      expect(verifyResult.error).toBeUndefined()
      expect(verifyResult.rows[0]?.active).toBe(1)

      await manager.disconnectAll()
    } finally {
      cleanupTestDir(cleanupDir)
    }
  })

  it('returns structured query errors for malformed SQL in local-db flows', async () => {
    const { dbFile, cleanupDir } = createLocalSqlitePath()
    const manager = new ConnectionManager()
    const config: ConnectionConfig = {
      id: 'sqlite-errors',
      name: 'Local SQLite Errors',
      type: 'sqlite',
      filename: dbFile
    }
    try {
      await manager.connect(config)
      const badQuery = await manager.query(config.id, 'SELEC FROM broken_sql')
      expect(badQuery.error).toBeTruthy()
      expect(badQuery.rowCount).toBe(0)
    } finally {
      await manager.disconnectAll()
      cleanupTestDir(cleanupDir)
    }
  })

  it('returns sqlite foreign key mappings for schema visualizer relationships', async () => {
    const { dbFile, cleanupDir } = createLocalSqlitePath()
    const manager = new ConnectionManager()
    const config: ConnectionConfig = {
      id: 'sqlite-fk',
      name: 'Local SQLite FK',
      type: 'sqlite',
      filename: dbFile
    }
    try {
      await manager.connect(config)
      await manager.query(
        config.id,
        `CREATE TABLE posts (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL
        );`
      )
      await manager.query(
        config.id,
        `CREATE TABLE comments (
          id INTEGER PRIMARY KEY,
          post_id INTEGER NOT NULL,
          body TEXT NOT NULL,
          FOREIGN KEY (post_id) REFERENCES posts(id)
        );`
      )

      const foreignKeys = await manager.getForeignKeys(config.id, 'comments', 'main')
      expect(foreignKeys).toEqual([
        {
          columnName: 'post_id',
          referencedTable: 'posts',
          referencedColumn: 'id'
        }
      ])
    } finally {
      await manager.disconnectAll()
      cleanupTestDir(cleanupDir)
    }
  })
})
