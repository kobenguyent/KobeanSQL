import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

type SQLiteRow = Record<string, unknown>

type SQLiteStatement = {
  all: (...params: unknown[]) => SQLiteRow[]
  run: (...params: unknown[]) => { changes: number }
  columns?: () => Array<{ name: string; type?: string }>
}

type SQLiteDatabase = {
  close: () => void
  prepare: (sql: string) => SQLiteStatement
  exec?: (sql: string) => void
  pragma?: (sql: string) => Array<{ name: string }>
  open?: boolean
}

export class SQLiteAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'sqlite'
  private db: SQLiteDatabase | null = null
  private connected = false

  private applyPragma(sql: string): void {
    if (!this.db) return
    if (this.db.pragma) {
      this.db.pragma(sql)
      return
    }
    this.db.exec?.(`PRAGMA ${sql};`)
  }

  private async openDatabase(filename: string): Promise<SQLiteDatabase> {
    try {
      const module = await import('better-sqlite3')
      const BetterSqlite3 = module.default
      return new BetterSqlite3(filename, { readonly: false }) as SQLiteDatabase
    } catch {
      const builtinSqlite = process.getBuiltinModule?.('node:sqlite')
      const DatabaseSync =
        typeof builtinSqlite === 'object' &&
        builtinSqlite !== null &&
        'DatabaseSync' in builtinSqlite &&
        typeof builtinSqlite.DatabaseSync === 'function'
          ? (builtinSqlite.DatabaseSync as new (path: string) => SQLiteDatabase)
          : undefined
      if (!DatabaseSync) {
        throw new Error('SQLite driver unavailable: failed to load better-sqlite3 and node:sqlite')
      }
      return new DatabaseSync(filename)
    }
  }

  async connect(config: ConnectionConfig): Promise<void> {
    const filename = config.filename || ':memory:'
    this.db = await this.openDatabase(filename)
    // Enable WAL mode for better performance
    this.applyPragma('journal_mode = WAL')
    this.applyPragma('foreign_keys = ON')
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (!this.db) throw new Error('Not connected')
    const start = Date.now()
    const trimmed = sql.trim().toLowerCase()
    const isSelect =
      trimmed.startsWith('select') || trimmed.startsWith('with') || trimmed.startsWith('pragma')
    if (isSelect) {
      const stmt = this.db.prepare(sql)
      const rows = stmt.all(...params) as SQLiteRow[]
      const metadataColumns = (stmt.columns?.() ?? []).map((col) => ({
        name: col.name,
        type: col.type || 'TEXT',
        nullable: true,
        primaryKey: false
      }))
      const duration = Date.now() - start
      const columns =
        rows.length > 0
          ? Object.keys(rows[0]).map((name) => ({ name, type: 'TEXT', nullable: true, primaryKey: false }))
          : metadataColumns
      return { columns, rows, rowCount: rows.length, duration }
    } else {
      const stmt = this.db.prepare(sql)
      const result = stmt.run(...params)
      const duration = Date.now() - start
      return {
        columns: [],
        rows: [],
        rowCount: result.changes,
        duration
      }
    }
  }


  async getDatabases(): Promise<string[]> {
    if (!this.db) return []
    // SQLite only has one database per connection
    if (this.db.pragma) {
      const result = this.db.pragma('database_list') as { name: string }[]
      return result.map((r) => r.name)
    }
    const result = await this.query('PRAGMA database_list')
    return result.rows
      .map((r) => r['name'])
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    const result = await this.query(
      `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    return result.rows.map((r) => ({
      name: r['name'] as string,
      type: (r['type'] as string) === 'view' ? 'view' : 'table'
    }))
  }

  async getColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    const result = await this.query(`PRAGMA table_info(${JSON.stringify(table)})`)
    return result.rows.map((r) => ({
      name: r['name'] as string,
      type: r['type'] as string,
      nullable: r['notnull'] === 0,
      primaryKey: r['pk'] !== 0,
      defaultValue: r['dflt_value'] as string | undefined
    }))
  }

  async getForeignKeys(table: string, _database?: string): Promise<ForeignKeyInfo[]> {
    const result = await this.query(`PRAGMA foreign_key_list(${JSON.stringify(table)})`)
    return result.rows.map((r) => ({
      columnName: r['from'] as string,
      referencedTable: r['table'] as string,
      referencedColumn: r['to'] as string
    }))
  }

  async getProcedures(_database?: string): Promise<ProcedureInfo[]> {
    // SQLite does not support stored procedures
    return []
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      const result = await this.query(`SELECT sqlite_version() AS version`)
      return (result.rows[0]?.['version'] as string) || 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
