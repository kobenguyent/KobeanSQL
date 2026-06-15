import mysql, { Pool, RowDataPacket, FieldPacket } from 'mysql2/promise'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'
import { resolveConnectionConfig } from '../connection-uri'

export class MySQLAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'mysql'
  private pool: Pool | null = null
  private config: ConnectionConfig | null = null
  private _connected = false
  private _onPoolError = (): void => { this._connected = false }

  async connect(config: ConnectionConfig): Promise<void> {
    const resolvedConfig = resolveConnectionConfig(config)
    this.config = resolvedConfig
    this.pool = mysql.createPool({
      host: resolvedConfig.host || 'localhost',
      port: resolvedConfig.port || 3306,
      user: resolvedConfig.user || 'root',
      password: resolvedConfig.password || '',
      database: resolvedConfig.database,
      ssl: resolvedConfig.ssl ? { rejectUnauthorized: false } : undefined,
      multipleStatements: true,
      connectTimeout: 10000,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 100, // Cap the queue to 100 pending queries
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    })

    // Verify connectivity eagerly so errors surface at connect time
    const conn = await this.pool.getConnection()
    conn.release()
    this._connected = true
    ;(this.pool as unknown as NodeJS.EventEmitter).on('error', this._onPoolError)
  }

  async disconnect(): Promise<void> {
    this._connected = false
    if (this.pool) {
      (this.pool as unknown as NodeJS.EventEmitter).off('error', this._onPoolError)
      await this.pool.end()
      this.pool = null
    }
  }

  isConnected(): boolean {
    return this._connected && this.pool !== null
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    const start = Date.now()
    try {
      const [rows, fields] = await conn.query<RowDataPacket[]>(sql, params)
      const duration = Date.now() - start
      const resultRows = Array.isArray(rows) ? rows : []
      const rowCount = Array.isArray(rows)
        ? resultRows.length
        : typeof (rows as { affectedRows?: unknown }).affectedRows === 'number'
          ? ((rows as { affectedRows: number }).affectedRows)
          : 0
      const columns = (fields as FieldPacket[] || []).map((f) => ({
        name: f.name,
        type: f.type?.toString() || 'unknown',
        nullable: !!(f.flags && ((f.flags as number) & 1) === 0),
        primaryKey: !!(f.flags && ((f.flags as number) & 2) !== 0)
      }))
      return {
        columns,
        rows: resultRows as Record<string, unknown>[],
        rowCount,
        duration
      }
    } catch (err) {
      await conn.rollback().catch(() => {})
      throw err
    } finally {
      const upperSql = sql.toUpperCase()
      if (upperSql.includes('START TRANSACTION') || upperSql.includes('BEGIN')) {
        await conn.rollback().catch(() => {})
      }
      conn.release()
    }
  }


  async getDatabases(): Promise<string[]> {
    const result = await this.query('SHOW DATABASES')
    return result.rows.map((r) => Object.values(r)[0] as string)
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    const db = database || this.config?.database
    if (!db) return []
    const result = await this.query(
      `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [db]
    )
    return result.rows.map((r) => ({
      name: r['TABLE_NAME'] as string,
      type: (r['TABLE_TYPE'] as string) === 'VIEW' ? 'view' : 'table',
      rowCount: r['TABLE_ROWS'] != null ? Number(r['TABLE_ROWS']) : undefined,
      engine: r['ENGINE'] != null ? r['ENGINE'] as string : undefined
    }))
  }

  async getColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    const db = database || this.config?.database
    if (!db) return []
    const result = await this.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [db, table]
    )
    return result.rows.map((r) => ({
      name: r['COLUMN_NAME'] as string,
      type: r['COLUMN_TYPE'] as string,
      nullable: r['IS_NULLABLE'] === 'YES',
      primaryKey: r['COLUMN_KEY'] === 'PRI',
      defaultValue: r['COLUMN_DEFAULT'] as string | undefined,
      comment: r['COLUMN_COMMENT'] as string | undefined
    }))
  }

  async getForeignKeys(table: string, database?: string): Promise<ForeignKeyInfo[]> {
    const db = database || this.config?.database
    if (!db) return []
    const result = await this.query(
      `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE kcu
       JOIN information_schema.TABLE_CONSTRAINTS tc
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
         AND tc.TABLE_NAME = kcu.TABLE_NAME
       WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
         AND kcu.TABLE_SCHEMA = ?
         AND kcu.TABLE_NAME = ?`,
      [db, table]
    )
    return result.rows
      .filter((r) => r['REFERENCED_TABLE_NAME'] != null)
      .map((r) => ({
        columnName: r['COLUMN_NAME'] as string,
        referencedTable: r['REFERENCED_TABLE_NAME'] as string,
        referencedColumn: r['REFERENCED_COLUMN_NAME'] as string
      }))
  }

  async getProcedures(database?: string): Promise<ProcedureInfo[]> {
    const db = database || this.config?.database
    if (!db) return []
    const result = await this.query(
      `SELECT ROUTINE_NAME, ROUTINE_SCHEMA, ROUTINE_TYPE
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ?
       ORDER BY ROUTINE_NAME`,
      [db]
    )
    return result.rows.map((r) => ({
      name: r['ROUTINE_NAME'] as string,
      schema: r['ROUTINE_SCHEMA'] as string,
      type: (r['ROUTINE_TYPE'] as string) === 'FUNCTION' ? 'function' : 'procedure'
    }))
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
      const result = await this.query('SELECT VERSION() AS version')
      return (result.rows[0]?.['version'] as string) || 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
