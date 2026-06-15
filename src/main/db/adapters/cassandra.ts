import cassandra from 'cassandra-driver'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

export class CassandraAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'cassandra'
  private client: cassandra.Client | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    const contactPoints = [config.host || 'localhost']
    const port = config.port || 9042
    const clientOptions: cassandra.ClientOptions = {
      contactPoints,
      localDataCenter: 'datacenter1',
      protocolOptions: { port },
      socketOptions: { connectTimeout: 10000 }
    }
    if (config.user && config.password) {
      clientOptions.credentials = { username: config.user, password: config.password }
    }
    if (config.database) {
      clientOptions.keyspace = config.database
    }
    if (config.ssl) {
      clientOptions.sslOptions = { rejectUnauthorized: false }
    }
    this.client = new cassandra.Client(clientOptions)
    await this.client.connect()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.shutdown()
      this.client = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client !== null
  }

  async query(cql: string, params: unknown[] = []): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected')
    const start = Date.now()
    const result = await this.client.execute(cql, params, { prepare: true })
    const columns = result.columns?.map((c) => ({
      name: c.name,
      type: c.type?.code?.toString() ?? 'unknown',
      nullable: true,
      primaryKey: false
    })) ?? []
    const rows = result.rows?.map((row) => {
      const record: Record<string, unknown> = {}
      for (const col of columns) {
        record[col.name] = row[col.name]
      }
      return record
    }) ?? []
    return { columns, rows, rowCount: rows.length, duration: Date.now() - start }
  }


  async getDatabases(): Promise<string[]> {
    const result = await this.query('SELECT keyspace_name FROM system_schema.keyspaces')
    return result.rows.map((r) => r['keyspace_name'] as string).filter(Boolean)
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    const keyspace = database || this.config?.database
    let cql: string
    const params: unknown[] = []
    if (keyspace) {
      cql = 'SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?'
      params.push(keyspace)
    } else {
      cql = 'SELECT keyspace_name, table_name FROM system_schema.tables'
    }
    const result = await this.query(cql, params)
    return result.rows.map((r) => ({
      name: r['table_name'] as string,
      type: 'table',
      schema: r['keyspace_name'] as string | undefined
    }))
  }

  async getColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    const keyspace = database || this.config?.database
    let cql: string
    const params: unknown[] = []
    if (keyspace) {
      cql = 'SELECT column_name, type, kind FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?'
      params.push(keyspace, table)
    } else {
      cql = 'SELECT column_name, type, kind FROM system_schema.columns WHERE table_name = ? ALLOW FILTERING'
      params.push(table)
    }
    const result = await this.query(cql, params)
    return result.rows.map((r) => ({
      name: r['column_name'] as string,
      type: r['type'] as string,
      nullable: r['kind'] !== 'partition_key' && r['kind'] !== 'clustering',
      primaryKey: r['kind'] === 'partition_key'
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
      await this.client.execute('SELECT now() FROM system.local')
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      const result = await this.query('SELECT release_version FROM system.local')
      const version = result.rows[0]?.['release_version'] as string | undefined
      return version ? `Cassandra ${version}` : 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
