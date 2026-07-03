import { InfluxDB, QueryApi } from '@influxdata/influxdb-client'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

export class InfluxDBAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'influxdb'
  private client: InfluxDB | null = null
  private queryApi: QueryApi | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    const protocol = config.ssl ? 'https' : 'http'
    const host = config.host || 'localhost'
    const port = config.port || 8086
    const url = `${protocol}://${host}:${port}`
    const token = config.password || ''

    this.client = new InfluxDB({ url, token })
    // Default org to user field or 'default'
    const org = config.user || 'default'
    this.queryApi = this.client.getQueryApi(org)
    // Verify connectivity
    await this.ping()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.client = null
    this.queryApi = null
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client !== null
  }

  async query(flux: string, _params: unknown[] = []): Promise<QueryResult> {
    if (!this.queryApi) throw new Error('Not connected')
    const start = Date.now()

    const rows: Record<string, unknown>[] = []
    const columnSet = new Set<string>()

    await new Promise<void>((resolve, reject) => {
      this.queryApi!.queryRows(flux, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row)
          Object.keys(o).forEach((k) => columnSet.add(k))
          rows.push(o)
        },
        error: reject,
        complete: resolve
      })
    })

    const columns = Array.from(columnSet).map((name) => ({ name, type: 'string' }))
    return {
      columns,
      rows,
      rowCount: rows.length,
      duration: Date.now() - start
    }
  }

  async getDatabases(): Promise<string[]> {
    if (!this.client || !this.config) throw new Error('Not connected')
    const org = this.config.user || 'default'
    const token = this.config.password || ''
    const protocol = this.config.ssl ? 'https' : 'http'
    const host = this.config.host || 'localhost'
    const port = this.config.port || 8086
    const url = `${protocol}://${host}:${port}/api/v2/buckets?org=${encodeURIComponent(org)}`

    const response = await fetch(url, {
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
    })
    if (!response.ok) return []
    const json = await response.json() as { buckets?: Array<{ name: string }> }
    return (json.buckets || []).map((b) => b.name)
  }

  async getTables(bucket?: string): Promise<TableInfo[]> {
    if (!this.queryApi || !this.config) throw new Error('Not connected')
    if (!bucket) return []
    const org = this.config.user || 'default'
    const flux = `import "influxdata/influxdb/schema"\nschema.measurements(bucket: "${bucket}")`

    const measurements: string[] = []
    const queryApi = this.client!.getQueryApi(org)
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(flux, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row)
          if (o['_value']) measurements.push(String(o['_value']))
        },
        error: reject,
        complete: resolve
      })
    })
    return measurements.map((m) => ({ name: m, type: 'table' as const }))
  }

  async getColumns(measurement: string, bucket?: string): Promise<ColumnInfo[]> {
    if (!this.queryApi || !this.config) throw new Error('Not connected')
    if (!bucket) return []
    const org = this.config.user || 'default'
    const flux = `import "influxdata/influxdb/schema"\nschema.fieldKeys(bucket: "${bucket}", measurement: "${measurement}")`

    const fields: ColumnInfo[] = []
    const queryApi = this.client!.getQueryApi(org)
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(flux, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row)
          if (o['_value']) {
            fields.push({ name: String(o['_value']), type: 'field', nullable: true, primaryKey: false })
          }
        },
        error: reject,
        complete: resolve
      })
    })
    // Always add timestamp as primary key column
    fields.unshift({ name: '_time', type: 'timestamp', nullable: false, primaryKey: true })
    return fields
  }

  async getForeignKeys(_table: string, _database?: string): Promise<ForeignKeyInfo[]> {
    return []
  }

  async getProcedures(_database?: string): Promise<ProcedureInfo[]> {
    return []
  }

  async ping(): Promise<boolean> {
    if (!this.config) return false
    const protocol = this.config.ssl ? 'https' : 'http'
    const host = this.config.host || 'localhost'
    const port = this.config.port || 8086
    try {
      const response = await fetch(`${protocol}://${host}:${port}/ping`, { signal: AbortSignal.timeout(5000) })
      return response.ok || response.status === 204
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    if (!this.config) return 'InfluxDB'
    const protocol = this.config.ssl ? 'https' : 'http'
    const host = this.config.host || 'localhost'
    const port = this.config.port || 8086
    try {
      const response = await fetch(`${protocol}://${host}:${port}/ping`, { signal: AbortSignal.timeout(5000) })
      const version = response.headers.get('X-Influxdb-Version') || response.headers.get('x-influxdb-version')
      return version ? `InfluxDB ${version}` : 'InfluxDB'
    } catch {
      return 'InfluxDB'
    }
  }
}
