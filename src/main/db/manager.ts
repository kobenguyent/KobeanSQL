import { EventEmitter } from 'events'
import { DatabaseAdapter } from './adapter'
import { MySQLAdapter } from './adapters/mysql'
import { MariaDBAdapter } from './adapters/mariadb'
import { PostgresAdapter } from './adapters/postgres'
import { SQLiteAdapter } from './adapters/sqlite'
import { MSSQLAdapter } from './adapters/mssql'
import { MongoDBAdapter } from './adapters/mongodb'
import { CockroachDBAdapter } from './adapters/cockroachdb'
import { ClickHouseAdapter } from './adapters/clickhouse'
import { CassandraAdapter } from './adapters/cassandra'
import { RedisAdapter } from './adapters/redis'
import { ElasticsearchAdapter } from './adapters/elasticsearch'
import { OracleAdapter } from './adapters/oracle'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from './types'
import { appLogger } from '../logger'

const DEFAULT_CONNECTION_TIMEOUT = 15000 // 15 seconds
const DEFAULT_QUERY_TIMEOUT = 30000 // 30 seconds
const MAX_ROW_LIMIT = 10000 // Default safety cap
const AUTO_LIMIT = 1000 // Auto-append limit for unbounded SELECTs
const CACHE_TTL = 60000 // 1 minute cache for metadata
const MAX_CACHE_SIZE = 1000 // Max entries in metadata cache

/** Safely extract a human-readable message from any thrown value. */
function extractErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err || 'Unknown error'
  if (typeof err === 'object') {
    // Driver errors often have 'message', 'detail', or 'text' fields
    const e = err as Record<string, unknown>
    const msg =
      (typeof e['message'] === 'string' && e['message'].trim()) ||
      (typeof e['detail'] === 'string' && e['detail'].trim()) ||
      (typeof e['text'] === 'string' && e['text'].trim()) ||
      (typeof e['msg'] === 'string' && e['msg'].trim())
    if (msg) return msg
    try { return JSON.stringify(err) } catch { /* fall through */ }
  }
  return 'Unknown error'
}

/** Utility to wrap a promise with a timeout */
async function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage))
    }, ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

/** Simple SQL interceptor to append LIMIT if missing */
function applySafetyLimit(sql: string, type: ConnectionConfig['type']): string {
  // Only apply to SQL-like databases
  if (!['mysql', 'mariadb', 'postgres', 'mssql', 'sqlite', 'cockroachdb', 'clickhouse', 'oracle', 'cassandra'].includes(type)) {
    return sql
  }

  const trimmedSql = sql.trim()
  const isQuery = /^(SELECT|WITH)\s+/i.test(trimmedSql)
  
  // If not a SELECT/WITH, or already has LIMIT/TOP/FETCH, don't touch it
  if (!isQuery) return sql
  
  const hasLimit = /\s+LIMIT\s+\d+/i.test(trimmedSql) || 
                   /\s+TOP\s+\d+/i.test(trimmedSql) || 
                   /\s+FETCH\s+NEXT\s+\d+/i.test(trimmedSql)

  if (hasLimit) return sql

  // Append limit based on dialect
  if (type === 'mssql') {
    // TOP is usually at the beginning, harder to regex-inject safely without a parser
    // But we can check if it's a simple SELECT and add TOP if it doesn't have it
    if (!/^SELECT\s+TOP\s+/i.test(trimmedSql) && /^SELECT\s+/i.test(trimmedSql)) {
      return trimmedSql.replace(/^SELECT\s+/i, `SELECT TOP ${AUTO_LIMIT} `)
    }
    return sql
  }
  
  if (type === 'oracle') {
    return `${trimmedSql} FETCH NEXT ${AUTO_LIMIT} ROWS ONLY`
  }

  return `${trimmedSql} LIMIT ${AUTO_LIMIT}`
}

export class ConnectionManager extends EventEmitter {
  private connections = new Map<string, DatabaseAdapter>()
  private metadataCache = new Map<string, { data: any; timestamp: number }>()
  private cacheCleanupTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.startCacheCleanup()
  }

  private startCacheCleanup(): void {
    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.metadataCache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
          this.metadataCache.delete(key)
        }
      }
    }, CACHE_TTL)
    // Ensure timer doesn't block process exit (relevant for CLI/scripts)
    if (this.cacheCleanupTimer.unref) {
      this.cacheCleanupTimer.unref()
    }
  }

  private createAdapter(type: ConnectionConfig['type']): DatabaseAdapter {
    switch (type) {
      case 'mysql':
        return new MySQLAdapter()
      case 'mariadb':
        return new MariaDBAdapter()
      case 'postgres':
        return new PostgresAdapter()
      case 'sqlite':
        return new SQLiteAdapter()
      case 'mssql':
        return new MSSQLAdapter()
      case 'mongodb':
        return new MongoDBAdapter()
      case 'cockroachdb':
        return new CockroachDBAdapter()
      case 'clickhouse':
        return new ClickHouseAdapter()
      case 'cassandra':
        return new CassandraAdapter()
      case 'redis':
        return new RedisAdapter()
      case 'elasticsearch':
        return new ElasticsearchAdapter()
      case 'oracle':
        return new OracleAdapter()
      default:
        throw new Error(`Unsupported database type: ${type}`)
    }
  }

  private getCached<T>(key: string): T | null {
    const entry = this.metadataCache.get(key)
    if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) {
      return entry.data as T
    }
    return null
  }

  private setCache(key: string, data: any): void {
    // Evict oldest if cache is full
    if (this.metadataCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.metadataCache.keys().next().value
      if (oldestKey) this.metadataCache.delete(oldestKey)
    }
    this.metadataCache.set(key, { data, timestamp: Date.now() })
  }

  private clearCache(connectionId?: string): void {
    if (connectionId) {
      for (const key of this.metadataCache.keys()) {
        if (key.startsWith(`${connectionId}:`)) {
          this.metadataCache.delete(key)
        }
      }
    } else {
      this.metadataCache.clear()
    }
  }


  async connect(config: ConnectionConfig): Promise<{ success: boolean; error?: string; detectedType?: ConnectionConfig['type'] }> {
    try {
      if (this.connections.has(config.id)) {
        await this.disconnect(config.id)
      }
      let adapter = this.createAdapter(config.type)
      await withTimeout(
        adapter.connect(config),
        DEFAULT_CONNECTION_TIMEOUT,
        `Connection timed out after ${DEFAULT_CONNECTION_TIMEOUT / 1000}s`
      )

      // Engine detection: If connected as 'mysql' but server is MariaDB, switch to MariaDBAdapter
      if (config.type === 'mysql') {
        try {
          const version = await adapter.getServerVersion()
          if (version.toLowerCase().includes('mariadb')) {
            appLogger.info('Detected MariaDB on mysql connection type, switching to MariaDBAdapter', { connectionId: config.id })
            await adapter.disconnect().catch(() => {})
            adapter = new MariaDBAdapter()
            await withTimeout(
              adapter.connect(config),
              DEFAULT_CONNECTION_TIMEOUT,
              `MariaDB switch connection timed out after ${DEFAULT_CONNECTION_TIMEOUT / 1000}s`
            )
          }
        } catch (err) {
          appLogger.warn('Failed to detect database engine version', {
            connectionId: config.id,
            error: (err as Error).message
          })
        }
      }

      this.connections.set(config.id, adapter)
      appLogger.info('Connected to database', { 
        connectionId: config.id, 
        name: config.name, 
        type: config.type,
        detectedType: adapter.dialect 
      })
      return { success: true, detectedType: adapter.dialect }
    } catch (err) {

      appLogger.error('Failed to connect to database', {
        connectionId: config.id,
        name: config.name,
        type: config.type,
        error: extractErrorMessage(err)
      })
      const message = extractErrorMessage(err)
      return { success: false, error: message }
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const adapter = this.connections.get(connectionId)
    if (adapter) {
      await adapter.disconnect()
      this.connections.delete(connectionId)
      this.clearCache(connectionId)
      appLogger.info('Disconnected database connection', { connectionId })
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [id] of this.connections) {
      await this.disconnect(id)
    }
    this.clearCache()
  }

  isConnected(connectionId: string): boolean {
    const adapter = this.connections.get(connectionId)
    if (!adapter) return false
    const live = adapter.isConnected()
    if (!live) {
      this.connections.delete(connectionId)
      this.clearCache(connectionId)
      appLogger.info('Connection lost, removed stale entry', { connectionId })
      this.emit('connection-lost', connectionId)
    }
    return live
  }

  async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string; detectedType?: ConnectionConfig['type'] }> {
    let adapter: DatabaseAdapter | null = null
    try {
      adapter = this.createAdapter(config.type)
      await withTimeout(
        adapter.connect(config),
        DEFAULT_CONNECTION_TIMEOUT,
        `Connection timed out after ${DEFAULT_CONNECTION_TIMEOUT / 1000}s`
      )

      let detectedType = adapter.dialect
      if (config.type === 'mysql') {
        try {
          const version = await adapter.getServerVersion()
          if (version.toLowerCase().includes('mariadb')) {
            detectedType = 'mariadb'
          }
        } catch { /* ignore */ }
      }

      const alive = await withTimeout(
        adapter.ping(),
        5000,
        'Ping timed out'
      )
      return { success: alive, detectedType }
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) }
    } finally {
      if (adapter) {
        await adapter.disconnect().catch(() => {})
      }
    }
  }

  async query(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult> {
    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    
    const startedAt = Date.now()
    try {
      const safeSql = applySafetyLimit(sql, adapter.dialect)

      const result = await withTimeout(
        adapter.query(safeSql, params),
        DEFAULT_QUERY_TIMEOUT,
        `Query timed out after ${DEFAULT_QUERY_TIMEOUT / 1000}s`
      )

      // Safeguard: Truncate massive result sets to prevent OOM
      if (result.rows.length > MAX_ROW_LIMIT) {
        appLogger.warn('Query result set truncated', {
          connectionId,
          originalRowCount: result.rows.length,
          limit: MAX_ROW_LIMIT
        })
        result.rows = result.rows.slice(0, MAX_ROW_LIMIT)
        result.error = (result.error ? result.error + ' ' : '') + `Result set limited to ${MAX_ROW_LIMIT} rows for safety.`
      }

      appLogger.info('Query executed', {
        connectionId,
        durationMs: Date.now() - startedAt,
        rowCount: result.rowCount,
        autoLimited: safeSql !== sql
      })
      return result
    } catch (error) {
      appLogger.error('Query execution failed', {
        connectionId,
        durationMs: Date.now() - startedAt,
        error: extractErrorMessage(error)
      })
      throw error
    }
  }


  async getDatabases(connectionId: string): Promise<string[]> {
    const cacheKey = `${connectionId}:databases`
    const cached = this.getCached<string[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    const data = await adapter.getDatabases()
    this.setCache(cacheKey, data)
    return data
  }

  async getTables(connectionId: string, database?: string): Promise<TableInfo[]> {
    const cacheKey = `${connectionId}:tables:${database || 'default'}`
    const cached = this.getCached<TableInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    const data = await adapter.getTables(database)
    this.setCache(cacheKey, data)
    return data
  }

  async getColumns(connectionId: string, table: string, database?: string): Promise<ColumnInfo[]> {
    const cacheKey = `${connectionId}:columns:${database || 'default'}:${table}`
    const cached = this.getCached<ColumnInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    const data = await adapter.getColumns(table, database)
    this.setCache(cacheKey, data)
    return data
  }

  async getForeignKeys(connectionId: string, table: string, database?: string): Promise<ForeignKeyInfo[]> {
    const cacheKey = `${connectionId}:fks:${database || 'default'}:${table}`
    const cached = this.getCached<ForeignKeyInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    const data = await adapter.getForeignKeys(table, database)
    this.setCache(cacheKey, data)
    return data
  }

  async getProcedures(connectionId: string, database?: string): Promise<ProcedureInfo[]> {
    const cacheKey = `${connectionId}:procedures:${database || 'default'}`
    const cached = this.getCached<ProcedureInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    const data = await adapter.getProcedures(database)
    this.setCache(cacheKey, data)
    return data
  }

  async getServerVersion(connectionId: string): Promise<string> {
    const cacheKey = `${connectionId}:version`
    const cached = this.getCached<string>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    const data = await adapter.getServerVersion()
    this.setCache(cacheKey, data)
    return data
  }
}
