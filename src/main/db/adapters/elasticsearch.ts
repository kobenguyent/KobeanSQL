import { Client } from '@elastic/elasticsearch'
import type { MappingProperty } from '@elastic/elasticsearch/lib/api/types'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

function flattenMappingProperties(
  properties: Record<string, MappingProperty>,
  prefix = ''
): ColumnInfo[] {
  const columns: ColumnInfo[] = []
  for (const [name, prop] of Object.entries(properties)) {
    const fullName = prefix ? `${prefix}.${name}` : name
    const p = prop as MappingProperty & { type?: string; properties?: Record<string, MappingProperty> }
    if (p.properties) {
      columns.push(...flattenMappingProperties(p.properties, fullName))
    } else {
      columns.push({ name: fullName, type: p.type ?? 'object', nullable: true, primaryKey: name === '_id' })
    }
  }
  return columns
}

export class ElasticsearchAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'elasticsearch'
  private client: Client | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    const protocol = config.ssl ? 'https' : 'http'
    const host = config.host || 'localhost'
    const port = config.port || 9200
    this.client = new Client({
      node: `${protocol}://${host}:${port}`,
      auth: config.user ? { username: config.user, password: config.password ?? '' } : undefined,
      // When ssl is enabled, allow self-signed certificates by default.
      // For production environments, provide a CA certificate in the config instead.
      tls: config.ssl ? { rejectUnauthorized: false } : undefined,
      requestTimeout: 10000
    })
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

  async query(dsl: string, _params: unknown[] = []): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected')
    const start = Date.now()
    const trimmed = dsl.trim()
    // Support "INDEX_NAME: {...}" or plain JSON body
    let index = this.config?.database || '*'
    let body: Record<string, unknown>

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0 && !trimmed.startsWith('{')) {
      index = trimmed.slice(0, colonIdx).trim()
      body = JSON.parse(trimmed.slice(colonIdx + 1).trim()) as Record<string, unknown>
    } else {
      body = JSON.parse(trimmed) as Record<string, unknown>
    }

    // Safety: Enforce size limit if not provided
    if (body.size === undefined) {
      body.size = 1000
    }

    const result = await this.client.search({ index, body })
    const hits = result.hits?.hits ?? []
    const rows = hits.map((hit) => {
      const source = (hit._source ?? {}) as Record<string, unknown>
      return { _id: hit._id, _index: hit._index, _score: hit._score, ...source }
    })
    const columns = rows.length > 0
      ? Object.keys(rows[0]).map((name) => ({ name, type: 'unknown', nullable: true, primaryKey: name === '_id' }))
      : []
    return { columns, rows, rowCount: hits.length, duration: Date.now() - start }
  }


  async getDatabases(): Promise<string[]> {
    // Elasticsearch doesn't have databases; return a virtual "default"
    return ['default']
  }

  async getTables(_database?: string): Promise<TableInfo[]> {
    if (!this.client) throw new Error('Not connected')
    const result = await this.client.cat.indices({ format: 'json' })
    const indices = (result as unknown as Array<{ index?: string; 'index'?: string }>)
    return indices
      .map((idx) => idx.index ?? idx['index'] ?? '')
      .filter((name) => name && !name.startsWith('.'))
      .map((name) => ({ name, type: 'table' as const }))
  }

  async getColumns(index: string, _database?: string): Promise<ColumnInfo[]> {
    if (!this.client) throw new Error('Not connected')
    try {
      const result = await this.client.indices.getMapping({ index })
      const indexMapping = result[index]
      const properties = (indexMapping?.mappings?.properties ?? {}) as Record<string, MappingProperty>
      const columns = flattenMappingProperties(properties)
      // Always include built-in meta fields
      return [
        { name: '_id', type: 'keyword', nullable: false, primaryKey: true },
        { name: '_index', type: 'keyword', nullable: false, primaryKey: false },
        ...columns
      ]
    } catch {
      return []
    }
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
      await this.client.ping()
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      if (!this.client) return 'Unknown'
      const info = await this.client.info()
      const version = (info as { version?: { number?: string } }).version?.number
      return version ? `Elasticsearch ${version}` : 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
