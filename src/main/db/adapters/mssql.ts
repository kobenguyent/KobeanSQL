import mssql from 'mssql'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'
import { resolveConnectionConfig } from '../connection-uri'

export class MSSQLAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'mssql'
  private pool: mssql.ConnectionPool | null = null
  private config: ConnectionConfig | null = null

  async connect(config: ConnectionConfig): Promise<void> {
    const resolvedConfig = resolveConnectionConfig(config)
    this.config = resolvedConfig
    this.pool = await mssql.connect({
      server: resolvedConfig.host || 'localhost',
      port: resolvedConfig.port || 1433,
      user: resolvedConfig.user,
      password: resolvedConfig.password,
      database: resolvedConfig.database,
      options: {
        encrypt: resolvedConfig.ssl ?? true,
        trustServerCertificate: true,
        connectTimeout: 10000
      },
      pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000
      }
    })
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close()
      this.pool = null
    }
  }

  isConnected(): boolean {
    return this.pool !== null && this.pool.connected
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const start = Date.now()
    const request = this.pool.request()
    params.forEach((p, i) => request.input(`p${i}`, p))
    try {
      const result = await request.query(sql)
      const duration = Date.now() - start
      const rows = result.recordset || []
      const metadataColumns = result.recordset?.columns
        ? Object.keys(result.recordset.columns)
        : []
      const columns = (rows.length > 0 ? Object.keys(rows[0]) : metadataColumns)
        .map((name) => ({ name, type: 'unknown', nullable: true, primaryKey: false }))
      const rowCount = rows.length > 0
        ? rows.length
        : result.rowsAffected.reduce((sum, count) => sum + count, 0)
      return {
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount,
        duration
      }
    } catch (err) {
      await this.pool.request().query('IF @@TRANCOUNT > 0 ROLLBACK').catch(() => {})
      throw err
    } finally {
      const upperSql = sql.toUpperCase()
      if (upperSql.includes('BEGIN TRANSACTION') || upperSql.includes('BEGIN TRAN')) {
        await this.pool.request().query('IF @@TRANCOUNT > 0 ROLLBACK').catch(() => {})
      }
    }
  }


  async getDatabases(): Promise<string[]> {
    const result = await this.query(`SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name`)
    return result.rows.map((r) => r['name'] as string)
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    const result = await this.query(
      `SELECT t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_SCHEMA, p.rows AS row_count
       FROM INFORMATION_SCHEMA.TABLES t
       LEFT JOIN sys.tables st ON st.name = t.TABLE_NAME
       LEFT JOIN sys.schemas ss ON ss.name = t.TABLE_SCHEMA AND ss.schema_id = st.schema_id
       LEFT JOIN sys.partitions p ON p.object_id = st.object_id AND p.index_id IN (0,1)
       ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME`
    )
    return result.rows.map((r) => ({
      name: r['TABLE_NAME'] as string,
      type: (r['TABLE_TYPE'] as string) === 'VIEW' ? 'view' : 'table',
      schema: r['TABLE_SCHEMA'] as string,
      rowCount: r['row_count'] != null ? Number(r['row_count']) : undefined
    }))
  }

  async getColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    const [schema, tableName] = table.includes('.') ? table.split('.') : ['dbo', table]
    const result = await this.query(
      `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
              CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PRIMARY_KEY
       FROM INFORMATION_SCHEMA.COLUMNS c
       LEFT JOIN (
         SELECT ku.COLUMN_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
         WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
           AND tc.TABLE_SCHEMA = @p0 AND tc.TABLE_NAME = @p1
       ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
       WHERE c.TABLE_SCHEMA = @p0 AND c.TABLE_NAME = @p1
       ORDER BY c.ORDINAL_POSITION`,
      [schema, tableName]
    )
    return result.rows.map((r) => ({
      name: r['COLUMN_NAME'] as string,
      type: r['DATA_TYPE'] as string,
      nullable: r['IS_NULLABLE'] === 'YES',
      primaryKey: r['IS_PRIMARY_KEY'] === 1,
      defaultValue: r['COLUMN_DEFAULT'] as string | undefined
    }))
  }

  async getForeignKeys(table: string, _database?: string): Promise<ForeignKeyInfo[]> {
    const [schema, tableName] = table.includes('.') ? table.split('.') : ['dbo', table]
    const result = await this.query(
      `SELECT src_col.name AS COLUMN_NAME,
              ref_schema.name + '.' + ref_table.name AS REFERENCED_TABLE,
              ref_col.name AS REFERENCED_COLUMN
       FROM sys.foreign_key_columns fkc
       JOIN sys.tables src_table
         ON src_table.object_id = fkc.parent_object_id
       JOIN sys.schemas src_schema
         ON src_schema.schema_id = src_table.schema_id
       JOIN sys.columns src_col
         ON src_col.object_id = fkc.parent_object_id
         AND src_col.column_id = fkc.parent_column_id
       JOIN sys.tables ref_table
         ON ref_table.object_id = fkc.referenced_object_id
       JOIN sys.schemas ref_schema
         ON ref_schema.schema_id = ref_table.schema_id
       JOIN sys.columns ref_col
         ON ref_col.object_id = fkc.referenced_object_id
         AND ref_col.column_id = fkc.referenced_column_id
       WHERE src_schema.name = @p0
         AND src_table.name = @p1
       ORDER BY fkc.constraint_object_id, fkc.constraint_column_id`,
      [schema, tableName]
    )
    return result.rows.map((r) => ({
      columnName: r['COLUMN_NAME'] as string,
      referencedTable: r['REFERENCED_TABLE'] as string,
      referencedColumn: r['REFERENCED_COLUMN'] as string
    }))
  }

  async getProcedures(_database?: string): Promise<ProcedureInfo[]> {
    // MSSQL routines are scoped to the connected database; the database param is not needed
    const result = await this.query(
      `SELECT SPECIFIC_NAME, ROUTINE_SCHEMA, ROUTINE_TYPE
       FROM INFORMATION_SCHEMA.ROUTINES
       ORDER BY ROUTINE_SCHEMA, SPECIFIC_NAME`
    )
    return result.rows.map((r) => ({
      name: r['SPECIFIC_NAME'] as string,
      schema: r['ROUTINE_SCHEMA'] as string,
      type: (r['ROUTINE_TYPE'] as string) === 'FUNCTION' ? 'function' : 'procedure'
    }))
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS ping')
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      const result = await this.query(`SELECT @@VERSION AS version`)
      const raw = (result.rows[0]?.['version'] as string) || 'Unknown'
      // @@VERSION returns a long string; extract first line
      return raw.split('\n')[0].trim()
    } catch {
      return 'Unknown'
    }
  }
}
