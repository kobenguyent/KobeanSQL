import snowflake from 'snowflake-sdk'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

function runStatement(stmt: snowflake.Statement): Promise<snowflake.Row[]> {
  return new Promise((resolve, reject) => {
    stmt.execute({
      complete(err, _stmt, rows) {
        if (err) reject(err)
        else resolve((rows ?? []) as snowflake.Row[])
      }
    })
  })
}

function createConnection(config: ConnectionConfig): snowflake.Connection {
  return snowflake.createConnection({
    account: config.host ?? '',
    username: config.user ?? '',
    password: config.password ?? '',
    database: config.database,
    warehouse: undefined,
    schema: undefined,
    authenticator: 'SNOWFLAKE'
  })
}

export class SnowflakeAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'snowflake'
  private connection: snowflake.Connection | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.connection = createConnection(config)
    await new Promise<void>((resolve, reject) => {
      this.connection!.connect((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await new Promise<void>((resolve) => {
        this.connection!.destroy((err) => {
          if (err) resolve() // ignore close errors
          else resolve()
        })
      })
      this.connection = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.connection !== null && this.connection.isUp()
  }

  async query(sql: string, _params: unknown[] = []): Promise<QueryResult> {
    if (!this.connection) throw new Error('Not connected')
    const start = Date.now()
    const stmt = this.connection.execute({ sqlText: sql })
    const rawRows = await runStatement(stmt)

    const rows = rawRows as Record<string, unknown>[]
    const columnSet = new Set<string>()
    rows.forEach((row) => Object.keys(row).forEach((k) => columnSet.add(k)))
    const columns = Array.from(columnSet).map((name) => ({ name, type: 'string' }))
    return { columns, rows, rowCount: rows.length, duration: Date.now() - start }
  }

  async getDatabases(): Promise<string[]> {
    if (!this.connection) throw new Error('Not connected')
    const stmt = this.connection.execute({ sqlText: 'SHOW DATABASES' })
    const rows = (await runStatement(stmt)) as Array<Record<string, unknown>>
    return rows.map((r) => String(r['name'] ?? r['Name'] ?? '')).filter(Boolean)
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    if (!this.connection) throw new Error('Not connected')
    const db = database ? `"${database.replace(/"/g, '""')}"..` : ''
    const stmt = this.connection.execute({ sqlText: `SHOW TABLES IN ${db}SCHEMA` })
    try {
      const rows = (await runStatement(stmt)) as Array<Record<string, unknown>>
      return rows.map((r) => ({ name: String(r['name'] ?? ''), type: 'table' as const }))
    } catch {
      // Fallback to information_schema
      const fallback = this.connection.execute({
        sqlText: `SELECT TABLE_NAME, TABLE_TYPE FROM ${database ? `"${database.replace(/"/g, '""')}".` : ''}INFORMATION_SCHEMA.TABLES`
      })
      const rows = (await runStatement(fallback)) as Array<Record<string, unknown>>
      return rows.map((r) => ({
        name: String(r['TABLE_NAME'] ?? ''),
        type: (String(r['TABLE_TYPE'] ?? 'TABLE') === 'VIEW' ? 'view' : 'table') as 'table' | 'view'
      }))
    }
  }

  async getColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    if (!this.connection) throw new Error('Not connected')
    const dbFilter = database ? `AND TABLE_CATALOG = '${database.replace(/'/g, "''")}'` : ''
    const stmt = this.connection.execute({
      sqlText: `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table.replace(/'/g, "''")}' ${dbFilter} ORDER BY ORDINAL_POSITION`
    })
    const rows = (await runStatement(stmt)) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      name: String(r['COLUMN_NAME'] ?? ''),
      type: String(r['DATA_TYPE'] ?? 'TEXT'),
      nullable: String(r['IS_NULLABLE'] ?? 'YES').toUpperCase() !== 'NO',
      primaryKey: false
    }))
  }

  async getForeignKeys(_table: string, _database?: string): Promise<ForeignKeyInfo[]> {
    return []
  }

  async getProcedures(database?: string): Promise<ProcedureInfo[]> {
    if (!this.connection) throw new Error('Not connected')
    const dbFilter = database ? `AND PROCEDURE_CATALOG = '${database.replace(/'/g, "''")}' ` : ''
    try {
      const stmt = this.connection.execute({
        sqlText: `SELECT PROCEDURE_NAME, PROCEDURE_SCHEMA FROM INFORMATION_SCHEMA.PROCEDURES WHERE 1=1 ${dbFilter}ORDER BY PROCEDURE_NAME`
      })
      const rows = (await runStatement(stmt)) as Array<Record<string, unknown>>
      return rows.map((r) => ({
        name: String(r['PROCEDURE_NAME'] ?? ''),
        schema: r['PROCEDURE_SCHEMA'] ? String(r['PROCEDURE_SCHEMA']) : undefined,
        type: 'procedure' as const
      }))
    } catch {
      return []
    }
  }

  async ping(): Promise<boolean> {
    if (!this.connection) return false
    try {
      const stmt = this.connection.execute({ sqlText: 'SELECT 1' })
      await runStatement(stmt)
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    if (!this.connection) return 'Snowflake'
    try {
      const stmt = this.connection.execute({ sqlText: 'SELECT CURRENT_VERSION() AS VERSION' })
      const rows = (await runStatement(stmt)) as Array<Record<string, unknown>>
      if (rows.length > 0) {
        return `Snowflake ${rows[0]['VERSION'] ?? ''}`
      }
    } catch { /* ignore */ }
    return 'Snowflake'
  }
}
