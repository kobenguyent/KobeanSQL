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
import { InfluxDBAdapter } from './adapters/influxdb'
import { Neo4jAdapter } from './adapters/neo4j'
import { SnowflakeAdapter } from './adapters/snowflake'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from './types'
import { getCapabilitiesForType as resolveCapabilitiesForType, type DatabaseManagementCapabilities } from './capabilities'
import {
  applyDetectedEngineToConfig,
  detectEngineFromFilePath,
  detectEngineFromUri,
  probeDatabaseEngine,
  refineEngineFromServerVersion,
  type EngineDetectionResult
} from './engine-detector'
import { appLogger } from '../logger'

const DEFAULT_CONNECTION_TIMEOUT = 15000 // 15 seconds
const DEFAULT_QUERY_TIMEOUT = 30000 // 30 seconds
const MAX_ROW_LIMIT = 10000 // Default safety cap
const AUTO_LIMIT = 1000 // Auto-append limit for unbounded SELECTs
const CACHE_TTL = 60000 // 1 minute cache for metadata
const MAX_CACHE_SIZE = 1000 // Max entries in metadata cache
const DEFAULT_AUTO_DISCONNECT_MINUTES = 15
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 15000

export interface AutoDisconnectConfig {
  enabled: boolean
  timeoutMs: number
  checkIntervalMs?: number
}

export interface AutoDisconnectEventPayload {
  connectionId: string
  idleMs: number
  reason: string
}

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
  if (!['mysql', 'mariadb', 'postgres', 'mssql', 'sqlite', 'cockroachdb', 'clickhouse', 'oracle', 'cassandra', 'snowflake'].includes(type)) {
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
  private lastActivityAt = new Map<string, number>()
  private activeOperations = new Map<string, number>()
  private autoDisconnectConfig: Required<AutoDisconnectConfig> = {
    enabled: true,
    timeoutMs: DEFAULT_AUTO_DISCONNECT_MINUTES * 60 * 1000,
    checkIntervalMs: DEFAULT_IDLE_CHECK_INTERVAL_MS
  }
  private idleSweepTimer: NodeJS.Timeout | null = null

  constructor(autoDisconnect?: Partial<AutoDisconnectConfig>) {
    super()
    if (autoDisconnect) {
      this.autoDisconnectConfig = {
        enabled: autoDisconnect.enabled ?? true,
        timeoutMs: Math.max(1000, autoDisconnect.timeoutMs ?? DEFAULT_AUTO_DISCONNECT_MINUTES * 60 * 1000),
        checkIntervalMs: Math.max(50, autoDisconnect.checkIntervalMs ?? DEFAULT_IDLE_CHECK_INTERVAL_MS)
      }
    }
    this.startCacheCleanup()
    this.restartIdleSweeper()
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

  private restartIdleSweeper(): void {
    if (this.idleSweepTimer) {
      clearInterval(this.idleSweepTimer)
      this.idleSweepTimer = null
    }
    if (!this.autoDisconnectConfig.enabled) return
    this.idleSweepTimer = setInterval(() => {
      void this.sweepIdleConnections()
    }, this.autoDisconnectConfig.checkIntervalMs)
    if (this.idleSweepTimer.unref) {
      this.idleSweepTimer.unref()
    }
  }

  setAutoDisconnectConfig(config: Partial<AutoDisconnectConfig>): void {
    this.autoDisconnectConfig = {
      enabled: config.enabled ?? this.autoDisconnectConfig.enabled,
      timeoutMs: config.timeoutMs !== undefined ? Math.max(1000, config.timeoutMs) : this.autoDisconnectConfig.timeoutMs,
      checkIntervalMs: config.checkIntervalMs !== undefined ? Math.max(50, config.checkIntervalMs) : this.autoDisconnectConfig.checkIntervalMs
    }
    this.restartIdleSweeper()
  }

  getAutoDisconnectConfig(): Required<AutoDisconnectConfig> {
    return { ...this.autoDisconnectConfig }
  }

  touchConnection(connectionId: string, now = Date.now()): void {
    if (this.connections.has(connectionId)) {
      this.lastActivityAt.set(connectionId, now)
    }
  }

  getConnectionIdleMs(connectionId: string, now = Date.now()): number | null {
    if (!this.connections.has(connectionId)) return null
    const last = this.lastActivityAt.get(connectionId)
    if (last === undefined) return null
    return Math.max(0, now - last)
  }

  private beginOperation(connectionId: string): void {
    this.lastActivityAt.set(connectionId, Date.now())
    this.activeOperations.set(connectionId, (this.activeOperations.get(connectionId) ?? 0) + 1)
  }

  private endOperation(connectionId: string): void {
    const count = this.activeOperations.get(connectionId) ?? 0
    if (count <= 1) {
      this.activeOperations.delete(connectionId)
    } else {
      this.activeOperations.set(connectionId, count - 1)
    }
    if (this.connections.has(connectionId)) {
      this.lastActivityAt.set(connectionId, Date.now())
    }
  }

  async sweepIdleConnections(now = Date.now()): Promise<AutoDisconnectEventPayload[]> {
    if (!this.autoDisconnectConfig.enabled) return []
    const threshold = this.autoDisconnectConfig.timeoutMs
    const expired: Array<{ connectionId: string; idleMs: number }> = []

    for (const [connectionId, lastUsed] of this.lastActivityAt.entries()) {
      if (!this.connections.has(connectionId)) continue
      if ((this.activeOperations.get(connectionId) ?? 0) > 0) continue
      const idleMs = now - lastUsed
      if (idleMs >= threshold) {
        expired.push({ connectionId, idleMs })
      }
    }

    const events: AutoDisconnectEventPayload[] = []
    for (const item of expired) {
      await this.disconnect(item.connectionId)
      const mins = Math.max(1, Math.round(threshold / 60000))
      const reason = threshold >= 60000
        ? `Auto-disconnected after ${mins}m of inactivity`
        : `Auto-disconnected after ${Math.round(threshold / 1000)}s of inactivity`
      const payload: AutoDisconnectEventPayload = {
        connectionId: item.connectionId,
        idleMs: item.idleMs,
        reason
      }
      appLogger.info('Auto-disconnected idle database connection', {
        connectionId: payload.connectionId,
        idleMs: payload.idleMs,
        reason: payload.reason
      })
      this.emit('auto-disconnected', payload)
      events.push(payload)
    }

    return events
  }

  dispose(): void {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer)
      this.cacheCleanupTimer = null
    }
    if (this.idleSweepTimer) {
      clearInterval(this.idleSweepTimer)
      this.idleSweepTimer = null
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
      case 'influxdb':
        return new InfluxDBAdapter()
      case 'neo4j':
        return new Neo4jAdapter()
      case 'snowflake':
        return new SnowflakeAdapter()
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


  async detectEngine(config: Partial<ConnectionConfig>): Promise<EngineDetectionResult | null> {
    return probeDatabaseEngine(config)
  }

  private prepareAutoRecognizedConfig(config: ConnectionConfig): {
    config: ConnectionConfig
    detectionDetail?: string
  } {
    if (config.connectionUri?.trim()) {
      const uriMatch = detectEngineFromUri(config.connectionUri)
      if (uriMatch && uriMatch.confidence === 'high' && uriMatch.engine !== config.type) {
        return {
          config: applyDetectedEngineToConfig(config, uriMatch),
          detectionDetail: uriMatch.detail
        }
      }
    }
    if (config.type !== 'sqlite' && config.filename?.trim()) {
      const fileMatch = detectEngineFromFilePath(config.filename)
      if (fileMatch) {
        return {
          config: applyDetectedEngineToConfig(config, fileMatch),
          detectionDetail: fileMatch.detail
        }
      }
    }
    return { config }
  }

  private async connectAdapterWithRefinement(
    config: ConnectionConfig
  ): Promise<{ adapter: DatabaseAdapter; effectiveConfig: ConnectionConfig; detectionDetail?: string }> {
    let effectiveConfig = config
    let adapter = this.createAdapter(effectiveConfig.type)
    await withTimeout(
      adapter.connect(effectiveConfig),
      DEFAULT_CONNECTION_TIMEOUT,
      `Connection timed out after ${DEFAULT_CONNECTION_TIMEOUT / 1000}s`
    )

    let detectionDetail: string | undefined

    // Post-connect engine refinement (MySQL <-> MariaDB, PostgreSQL -> CockroachDB)
    if (effectiveConfig.type === 'mysql' || effectiveConfig.type === 'mariadb' || effectiveConfig.type === 'postgres') {
      try {
        const version = await adapter.getServerVersion()
        const refined = refineEngineFromServerVersion(version, effectiveConfig.type)
        if (refined && refined.engine !== effectiveConfig.type) {
          appLogger.info(`Detected ${refined.engine} on ${effectiveConfig.type} connection, switching adapter`, {
            connectionId: effectiveConfig.id,
            version
          })
          await adapter.disconnect().catch(() => {})
          effectiveConfig = applyDetectedEngineToConfig(effectiveConfig, refined)
          adapter = this.createAdapter(effectiveConfig.type)
          await withTimeout(
            adapter.connect(effectiveConfig),
            DEFAULT_CONNECTION_TIMEOUT,
            `${refined.engine} switch connection timed out after ${DEFAULT_CONNECTION_TIMEOUT / 1000}s`
          )
          detectionDetail = refined.detail
        }
      } catch (err) {
        appLogger.warn('Failed to detect database engine version', {
          connectionId: effectiveConfig.id,
          error: (err as Error).message
        })
      }
    }

    return { adapter, effectiveConfig, detectionDetail }
  }

  async connect(config: ConnectionConfig): Promise<{
    success: boolean
    error?: string
    detectedType?: ConnectionConfig['type']
    resolvedConfig?: ConnectionConfig
    detectionDetail?: string
  }> {
    try {
      if (this.connections.has(config.id)) {
        await this.disconnect(config.id)
      }

      const prepared = this.prepareAutoRecognizedConfig(config)
      let result: { adapter: DatabaseAdapter; effectiveConfig: ConnectionConfig; detectionDetail?: string }

      try {
        result = await this.connectAdapterWithRefinement(prepared.config)
      } catch (initialErr) {
        // Fallback: probe live endpoint if initial connect failed and check if another engine is running there
        const probed = await probeDatabaseEngine(prepared.config, 1500).catch(() => null)
        if (probed && probed.engine !== prepared.config.type) {
          const switched = applyDetectedEngineToConfig(prepared.config, probed)
          result = await this.connectAdapterWithRefinement(switched)
          result.detectionDetail = probed.detail
        } else {
          throw initialErr
        }
      }

      this.connections.set(config.id, result.adapter)
      this.lastActivityAt.set(config.id, Date.now())
      const detectionDetail = result.detectionDetail ?? prepared.detectionDetail
      appLogger.info('Connected to database', {
        connectionId: config.id,
        name: config.name,
        type: config.type,
        detectedType: result.adapter.dialect
      })
      return {
        success: true,
        detectedType: result.adapter.dialect,
        resolvedConfig: result.adapter.dialect !== config.type ? result.effectiveConfig : undefined,
        detectionDetail
      }
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
    this.lastActivityAt.delete(connectionId)
    this.activeOperations.delete(connectionId)
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
      this.lastActivityAt.delete(connectionId)
      this.activeOperations.delete(connectionId)
      this.clearCache(connectionId)
      appLogger.info('Connection lost, removed stale entry', { connectionId })
      this.emit('connection-lost', connectionId)
    }
    return live
  }

  getActiveConnections(): { id: string; adapter: DatabaseAdapter }[] {
    return Array.from(this.connections.entries()).map(([id, adapter]) => ({ id, adapter }))
  }

  getCapabilitiesForType(type: ConnectionConfig['type']): DatabaseManagementCapabilities {
    return resolveCapabilitiesForType(type)
  }

  getConnectionDialect(connectionId: string): ConnectionConfig['type'] {
    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    return adapter.dialect
  }

  async testConnection(config: ConnectionConfig): Promise<{
    success: boolean
    error?: string
    detectedType?: ConnectionConfig['type']
    resolvedConfig?: ConnectionConfig
    detectionDetail?: string
  }> {
    let adapter: DatabaseAdapter | null = null
    try {
      const prepared = this.prepareAutoRecognizedConfig(config)
      let effectiveConfig = prepared.config
      let detectionDetail = prepared.detectionDetail

      try {
        adapter = this.createAdapter(effectiveConfig.type)
        await withTimeout(
          adapter.connect(effectiveConfig),
          DEFAULT_CONNECTION_TIMEOUT,
          `Connection timed out after ${DEFAULT_CONNECTION_TIMEOUT / 1000}s`
        )
      } catch (initialErr) {
        if (adapter) {
          await adapter.disconnect().catch(() => {})
          adapter = null
        }
        const probed = await probeDatabaseEngine(effectiveConfig, 1500).catch(() => null)
        if (probed && probed.engine !== effectiveConfig.type) {
          effectiveConfig = applyDetectedEngineToConfig(effectiveConfig, probed)
          detectionDetail = probed.detail
          adapter = this.createAdapter(effectiveConfig.type)
          await withTimeout(
            adapter.connect(effectiveConfig),
            DEFAULT_CONNECTION_TIMEOUT,
            `Connection timed out after ${DEFAULT_CONNECTION_TIMEOUT / 1000}s`
          )
        } else {
          throw initialErr
        }
      }

      let detectedType = adapter.dialect
      if (effectiveConfig.type === 'mysql' || effectiveConfig.type === 'mariadb' || effectiveConfig.type === 'postgres') {
        try {
          const version = await adapter.getServerVersion()
          const refined = refineEngineFromServerVersion(version, effectiveConfig.type)
          if (refined && refined.engine !== effectiveConfig.type) {
            detectedType = refined.engine
            effectiveConfig = applyDetectedEngineToConfig(effectiveConfig, refined)
            detectionDetail = refined.detail
          }
        } catch { /* ignore */ }
      }

      const alive = await withTimeout(
        adapter.ping(),
        5000,
        'Ping timed out'
      )
      return {
        success: alive,
        detectedType,
        resolvedConfig: detectedType !== config.type ? effectiveConfig : undefined,
        detectionDetail
      }
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

    this.beginOperation(connectionId)
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
    } finally {
      this.endOperation(connectionId)
    }
  }


  async getDatabases(connectionId: string): Promise<string[]> {
    this.touchConnection(connectionId)
    const cacheKey = `${connectionId}:databases`
    const cached = this.getCached<string[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    this.beginOperation(connectionId)
    try {
      const data = await adapter.getDatabases()
      this.setCache(cacheKey, data)
      return data
    } finally {
      this.endOperation(connectionId)
    }
  }

  async getTables(connectionId: string, database?: string): Promise<TableInfo[]> {
    this.touchConnection(connectionId)
    const cacheKey = `${connectionId}:tables:${database || 'default'}`
    const cached = this.getCached<TableInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    this.beginOperation(connectionId)
    try {
      const data = await adapter.getTables(database)
      this.setCache(cacheKey, data)
      return data
    } finally {
      this.endOperation(connectionId)
    }
  }

  async getColumns(connectionId: string, table: string, database?: string): Promise<ColumnInfo[]> {
    this.touchConnection(connectionId)
    const cacheKey = `${connectionId}:columns:${database || 'default'}:${table}`
    const cached = this.getCached<ColumnInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    this.beginOperation(connectionId)
    try {
      const data = await adapter.getColumns(table, database)
      this.setCache(cacheKey, data)
      return data
    } finally {
      this.endOperation(connectionId)
    }
  }

  async getForeignKeys(connectionId: string, table: string, database?: string): Promise<ForeignKeyInfo[]> {
    this.touchConnection(connectionId)
    const cacheKey = `${connectionId}:fks:${database || 'default'}:${table}`
    const cached = this.getCached<ForeignKeyInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    this.beginOperation(connectionId)
    try {
      const data = await adapter.getForeignKeys(table, database)
      this.setCache(cacheKey, data)
      return data
    } finally {
      this.endOperation(connectionId)
    }
  }

  async getProcedures(connectionId: string, database?: string): Promise<ProcedureInfo[]> {
    this.touchConnection(connectionId)
    const cacheKey = `${connectionId}:procedures:${database || 'default'}`
    const cached = this.getCached<ProcedureInfo[]>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    this.beginOperation(connectionId)
    try {
      const data = await adapter.getProcedures(database)
      this.setCache(cacheKey, data)
      return data
    } finally {
      this.endOperation(connectionId)
    }
  }

  async getServerVersion(connectionId: string): Promise<string> {
    this.touchConnection(connectionId)
    const cacheKey = `${connectionId}:version`
    const cached = this.getCached<string>(cacheKey)
    if (cached) return cached

    const adapter = this.connections.get(connectionId)
    if (!adapter) throw new Error(`Not connected: ${connectionId}`)
    this.beginOperation(connectionId)
    try {
      const data = await adapter.getServerVersion()
      this.setCache(cacheKey, data)
      return data
    } finally {
      this.endOperation(connectionId)
    }
  }
}
