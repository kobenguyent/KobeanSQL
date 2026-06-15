import { createClient, ClickHouseClient, ResponseJSON } from '@clickhouse/client'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

export class ClickHouseAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'clickhouse'
  private client: ClickHouseClient | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    const host = config.host || 'localhost'
    const port = config.port || 8123
    const protocol = config.ssl ? 'https' : 'http'
    this.client = createClient({
      url: `${protocol}://${host}:${port}`,
      username: config.user || 'default',
      password: config.password || '',
      database: config.database || 'default',
      request_timeout: 10000
    })
    // Verify connectivity
    await this.client.ping()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client !== null
  }

  async query(sql: string, _params: unknown[] = []): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected')
    const start = Date.now()
    const trimmed = sql.trim().toUpperCase()
    const isSelect =
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('SHOW') ||
      trimmed.startsWith('DESCRIBE') ||
      trimmed.startsWith('EXPLAIN') ||
      trimmed.startsWith('WITH')
    if (isSelect) {
      const result = await this.client.query({ query: sql, format: 'JSONCompact' })
      const json = await result.json<ResponseJSON<unknown[]>>()
      const meta = (json as { meta?: { name: string; type: string }[] }).meta ?? []
      const data = (json as { data?: unknown[][] }).data ?? []
      const columns = meta.map((m) => ({ name: m.name, type: m.type, nullable: true, primaryKey: false }))
      const rows = data.map((row) => {
        const record: Record<string, unknown> = {}
        meta.forEach((m, i) => { record[m.name] = (row as unknown[])[i] })
        return record
      })
      return { columns, rows, rowCount: rows.length, duration: Date.now() - start }
    } else {
      await this.client.command({ query: sql })
      return { columns: [], rows: [], rowCount: 0, duration: Date.now() - start }
    }
  }


  async getDatabases(): Promise<string[]> {
    const result = await this.query('SHOW DATABASES')
    return result.rows.map((r) => (r['name'] ?? r['database']) as string).filter(Boolean)
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    const db = database || this.config?.database || 'default'
    const result = await this.query(`SHOW TABLES FROM \`${db}\``)
    const nameKey = result.columns[0]?.name ?? 'name'
    return result.rows.map((r) => ({ name: r[nameKey] as string, type: 'table' }))
  }

  async getColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    const db = database || this.config?.database || 'default'
    const result = await this.query(`DESCRIBE TABLE \`${db}\`.\`${table}\``)
    return result.rows.map((r) => ({
      name: r['name'] as string,
      type: r['type'] as string,
      nullable: typeof r['type'] === 'string' && r['type'].includes('Nullable('),
      primaryKey: false
    }))
  }

  async getForeignKeys(_table: string, _database?: string): Promise<ForeignKeyInfo[]> {
    return []
  }

  async getProcedures(_database?: string): Promise<ProcedureInfo[]> {
    return []
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.client) return false
      const result = await this.client.ping()
      return result.success
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      const result = await this.query('SELECT version() AS version')
      return (result.rows[0]?.['version'] as string) || 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
