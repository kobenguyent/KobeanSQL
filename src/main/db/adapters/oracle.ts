import oracledb from 'oracledb'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

export class OracleAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'oracle'
  private pool: oracledb.Pool | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    const connectString = config.connectionUri?.trim()
      || `${config.host || 'localhost'}:${config.port || 1521}/${config.database || 'ORCL'}`

    this.pool = await oracledb.createPool({
      user: config.user || '',
      password: config.password || '',
      connectString,
      poolMax: 5,
      poolMin: 1,
      poolTimeout: 30
    })
    
    // Verify connectivity
    const conn = await this.pool.getConnection()
    await conn.close()
    
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close(0)
      this.pool = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.pool !== null
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const start = Date.now()
    let connection: oracledb.Connection | null = null
    try {
      connection = await this.pool.getConnection()
      // Remove trailing semicolons — Oracle does not accept them in execute()
      const normalizedSql = sql.trim().replace(/;+$/, '')
      const result = await connection.execute(normalizedSql, params, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchArraySize: 200,
        autoCommit: true
      })
      const metaData = result.metaData ?? []
      const columns = metaData.map((m) => ({
        name: m.name,
        type: m.dbType?.toString() ?? 'unknown',
        nullable: true,
        primaryKey: false
      }))
      const rows = (result.rows ?? []) as Record<string, unknown>[]
      const rowsAffected = result.rowsAffected ?? 0
      return {
        columns,
        rows,
        rowCount: rows.length > 0 ? rows.length : rowsAffected,
        duration: Date.now() - start
      }
    } finally {
      if (connection) {
        await connection.close().catch(() => {})
      }
    }
  }



  async getDatabases(): Promise<string[]> {
    // Oracle doesn't have the concept of multiple databases per instance.
    // Return the pluggable databases (PDBs) if available, otherwise the SID.
    try {
      const result = await this.query('SELECT NAME FROM V$DATABASE')
      return result.rows.map((r) => r['NAME'] as string).filter(Boolean)
    } catch {
      return [this.config?.database || 'ORCL']
    }
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    const owner = (database || this.config?.user || '').toUpperCase()
    let sql: string
    const params: unknown[] = []
    if (owner) {
      sql = `SELECT TABLE_NAME, 'TABLE' AS TABLE_TYPE FROM ALL_TABLES WHERE OWNER = :1
             UNION ALL
             SELECT VIEW_NAME AS TABLE_NAME, 'VIEW' AS TABLE_TYPE FROM ALL_VIEWS WHERE OWNER = :2
             ORDER BY TABLE_NAME`
      params.push(owner, owner)
    } else {
      sql = `SELECT TABLE_NAME, 'TABLE' AS TABLE_TYPE FROM USER_TABLES
             UNION ALL
             SELECT VIEW_NAME AS TABLE_NAME, 'VIEW' AS TABLE_TYPE FROM USER_VIEWS
             ORDER BY TABLE_NAME`
    }
    const result = await this.query(sql, params)
    return result.rows.map((r) => ({
      name: r['TABLE_NAME'] as string,
      type: (r['TABLE_TYPE'] as string) === 'VIEW' ? 'view' : 'table',
      schema: owner || undefined
    }))
  }

  async getColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    const owner = (database || this.config?.user || '').toUpperCase()
    const [resolvedOwner, resolvedTable] = table.includes('.')
      ? table.split('.').map((p) => p.toUpperCase())
      : [owner, table.toUpperCase()]

    let sql: string
    const params: unknown[] = []
    if (resolvedOwner) {
      sql = `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT,
                    CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'Y' ELSE 'N' END AS IS_PK
             FROM ALL_TAB_COLUMNS c
             LEFT JOIN (
               SELECT cc.COLUMN_NAME
               FROM ALL_CONSTRAINTS con
               JOIN ALL_CONS_COLUMNS cc ON con.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND con.OWNER = cc.OWNER
               WHERE con.CONSTRAINT_TYPE = 'P' AND con.OWNER = :1 AND con.TABLE_NAME = :2
             ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
             WHERE c.OWNER = :3 AND c.TABLE_NAME = :4
             ORDER BY c.COLUMN_ID`
      params.push(resolvedOwner, resolvedTable, resolvedOwner, resolvedTable)
    } else {
      sql = `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT,
                    CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'Y' ELSE 'N' END AS IS_PK
             FROM USER_TAB_COLUMNS c
             LEFT JOIN (
               SELECT cc.COLUMN_NAME
               FROM USER_CONSTRAINTS con
               JOIN USER_CONS_COLUMNS cc ON con.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
               WHERE con.CONSTRAINT_TYPE = 'P' AND con.TABLE_NAME = :1
             ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
             WHERE c.TABLE_NAME = :2
             ORDER BY c.COLUMN_ID`
      params.push(resolvedTable, resolvedTable)
    }
    const result = await this.query(sql, params)
    return result.rows.map((r) => ({
      name: r['COLUMN_NAME'] as string,
      type: r['DATA_TYPE'] as string,
      nullable: r['NULLABLE'] === 'Y',
      primaryKey: r['IS_PK'] === 'Y',
      defaultValue: r['DATA_DEFAULT'] as string | undefined
    }))
  }

  async getForeignKeys(table: string, database?: string): Promise<ForeignKeyInfo[]> {
    const owner = (database || this.config?.user || '').toUpperCase()
    const [resolvedOwner, resolvedTable] = table.includes('.')
      ? table.split('.').map((p) => p.toUpperCase())
      : [owner, table.toUpperCase()]

    let sql: string
    const params: unknown[] = []
    if (resolvedOwner) {
      sql = `SELECT cc.COLUMN_NAME, rc.OWNER || '.' || rc.TABLE_NAME AS REFERENCED_TABLE, rc.COLUMN_NAME AS REFERENCED_COLUMN
             FROM ALL_CONSTRAINTS con
             JOIN ALL_CONS_COLUMNS cc ON con.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND con.OWNER = cc.OWNER
             JOIN ALL_CONS_COLUMNS rc ON con.R_CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND con.R_OWNER = rc.OWNER
               AND cc.POSITION = rc.POSITION
             WHERE con.CONSTRAINT_TYPE = 'R' AND con.OWNER = :1 AND con.TABLE_NAME = :2
             ORDER BY cc.POSITION`
      params.push(resolvedOwner, resolvedTable)
    } else {
      sql = `SELECT cc.COLUMN_NAME, rc.TABLE_NAME AS REFERENCED_TABLE, rc.COLUMN_NAME AS REFERENCED_COLUMN
             FROM USER_CONSTRAINTS con
             JOIN USER_CONS_COLUMNS cc ON con.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
             JOIN USER_CONS_COLUMNS rc ON con.R_CONSTRAINT_NAME = rc.CONSTRAINT_NAME
               AND cc.POSITION = rc.POSITION
             WHERE con.CONSTRAINT_TYPE = 'R' AND con.TABLE_NAME = :1
             ORDER BY cc.POSITION`
      params.push(resolvedTable)
    }
    const result = await this.query(sql, params)
    return result.rows.map((r) => ({
      columnName: r['COLUMN_NAME'] as string,
      referencedTable: r['REFERENCED_TABLE'] as string,
      referencedColumn: r['REFERENCED_COLUMN'] as string
    }))
  }

  async getProcedures(database?: string): Promise<ProcedureInfo[]> {
    const owner = (database || this.config?.user || '').toUpperCase()
    let sql: string
    const params: unknown[] = []
    if (owner) {
      sql = `SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_PROCEDURES
             WHERE OWNER = :1 AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
             ORDER BY OBJECT_NAME`
      params.push(owner)
    } else {
      sql = `SELECT OBJECT_NAME, OBJECT_TYPE FROM USER_PROCEDURES
             WHERE OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
             ORDER BY OBJECT_NAME`
    }
    const result = await this.query(sql, params)
    return result.rows.map((r) => ({
      name: r['OBJECT_NAME'] as string,
      schema: owner || undefined,
      type: (r['OBJECT_TYPE'] as string).toLowerCase() === 'function' ? 'function' : 'procedure'
    }))
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 FROM DUAL')
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      const result = await this.query('SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1')
      return (result.rows[0]?.['BANNER'] as string) || 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
