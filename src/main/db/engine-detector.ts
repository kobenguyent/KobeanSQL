import fs from 'fs'
import http from 'http'
import https from 'https'
import net from 'net'
import path from 'path'
import type { ConnectionConfig, DatabaseType } from './types'
import { parseAnyConnectionUri, type ParsedUriConfig } from './connection-uri'

export type DetectionConfidence = 'high' | 'medium' | 'low'
export type DetectionSource =
  | 'uri-scheme'
  | 'file-magic'
  | 'file-extension'
  | 'wire-protocol'
  | 'http-probe'
  | 'server-version'
  | 'hostname-hint'
  | 'default-port'

export interface EngineDetectionResult {
  engine: DatabaseType
  confidence: DetectionConfidence
  source: DetectionSource
  detail: string
  suggestedPort?: number
  suggestedSSL?: boolean
  parsedUri?: ParsedUriConfig
  filePath?: string
}

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8')
const SQLITE_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db', '.s3db', '.sl3'])

export const ENGINE_DEFAULT_PORTS: Partial<Record<DatabaseType, number>> = {
  mysql: 3306,
  mariadb: 3306,
  postgres: 5432,
  cockroachdb: 26257,
  mssql: 1433,
  mongodb: 27017,
  clickhouse: 8123,
  cassandra: 9042,
  redis: 6379,
  elasticsearch: 9200,
  oracle: 1521,
  influxdb: 8086,
  neo4j: 7474
}

export const ENGINE_DEFAULT_USERS: Partial<Record<DatabaseType, string>> = {
  postgres: 'postgres',
  cockroachdb: 'root',
  mysql: 'root',
  mariadb: 'root',
  mssql: 'sa',
  clickhouse: 'default',
  neo4j: 'neo4j',
  elasticsearch: 'elastic',
  oracle: 'system'
}

export function detectEngineFromFilePath(rawPath?: string): EngineDetectionResult | null {
  const trimmed = rawPath?.trim()
  if (!trimmed) return null

  if (trimmed === ':memory:') {
    return {
      engine: 'sqlite',
      confidence: 'high',
      source: 'file-extension',
      detail: 'Recognized in-memory SQLite database',
      filePath: trimmed
    }
  }

  try {
    if (fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
      const fd = fs.openSync(trimmed, 'r')
      try {
        const buf = Buffer.alloc(SQLITE_MAGIC.length)
        const bytesRead = fs.readSync(fd, buf, 0, SQLITE_MAGIC.length, 0)
        if (bytesRead === SQLITE_MAGIC.length && buf.equals(SQLITE_MAGIC)) {
          return {
            engine: 'sqlite',
            confidence: 'high',
            source: 'file-magic',
            detail: 'Verified SQLite 3 database file header',
            filePath: trimmed
          }
        }
      } finally {
        fs.closeSync(fd)
      }
    }
  } catch {
    // Ignore fs read errors and fall back to extension check
  }

  const ext = path.extname(trimmed).toLowerCase()
  if (SQLITE_EXTENSIONS.has(ext)) {
    return {
      engine: 'sqlite',
      confidence: 'high',
      source: 'file-extension',
      detail: `Recognized SQLite from ${ext} file path`,
      filePath: trimmed
    }
  }

  return null
}

export function detectEngineFromHostname(rawHost?: string): EngineDetectionResult | null {
  const host = rawHost?.trim().toLowerCase()
  if (!host) return null

  if (host.includes('snowflakecomputing.com')) {
    return { engine: 'snowflake', confidence: 'high', source: 'hostname-hint', detail: 'Recognized Snowflake cloud hostname', suggestedSSL: true }
  }
  if (host.includes('cockroachlabs.cloud') || host.includes('cockroach')) {
    return { engine: 'cockroachdb', confidence: 'high', source: 'hostname-hint', detail: 'Recognized CockroachDB hostname', suggestedPort: 26257, suggestedSSL: host.includes('cockroachlabs.cloud') ? true : undefined }
  }
  if (host.includes('mongodb.net') || host.includes('mongodb.com')) {
    return { engine: 'mongodb', confidence: 'high', source: 'hostname-hint', detail: 'Recognized MongoDB Atlas hostname', suggestedPort: 27017, suggestedSSL: true }
  }
  if (host.includes('clickhouse.cloud') || host.includes('clickhouse')) {
    return { engine: 'clickhouse', confidence: 'high', source: 'hostname-hint', detail: 'Recognized ClickHouse hostname', suggestedPort: host.includes('clickhouse.cloud') ? 8443 : 8123, suggestedSSL: host.includes('clickhouse.cloud') ? true : undefined }
  }
  if (host.includes('influxdata.com') || host.includes('influxdb')) {
    return { engine: 'influxdb', confidence: 'high', source: 'hostname-hint', detail: 'Recognized InfluxDB hostname', suggestedPort: 8086, suggestedSSL: host.includes('influxdata.com') ? true : undefined }
  }
  if (host.includes('databases.neo4j.io') || host.includes('neo4j')) {
    return { engine: 'neo4j', confidence: 'high', source: 'hostname-hint', detail: 'Recognized Neo4j hostname', suggestedPort: 7474, suggestedSSL: host.includes('neo4j.io') ? true : undefined }
  }
  if (host.includes('elastic-cloud.com') || host.includes('es.amazonaws.com') || host.includes('elasticsearch')) {
    return { engine: 'elasticsearch', confidence: 'high', source: 'hostname-hint', detail: 'Recognized Elasticsearch hostname', suggestedPort: 9200, suggestedSSL: host.includes('elastic-cloud.com') ? true : undefined }
  }
  if (host.includes('upstash.io') || host.includes('redislabs.com') || host.includes('redis.cache.windows.net') || host.includes('cache.amazonaws.com')) {
    return { engine: 'redis', confidence: 'high', source: 'hostname-hint', detail: 'Recognized Redis cloud hostname', suggestedPort: 6379, suggestedSSL: true }
  }
  if (host.includes('database.windows.net')) {
    return { engine: 'mssql', confidence: 'high', source: 'hostname-hint', detail: 'Recognized Azure SQL Server hostname', suggestedPort: 1433, suggestedSSL: true }
  }
  if (host.includes('neon.tech') || host.includes('supabase.co') || host.includes('supabase.com')) {
    return { engine: 'postgres', confidence: 'high', source: 'hostname-hint', detail: 'Recognized managed PostgreSQL hostname', suggestedPort: 5432, suggestedSSL: true }
  }

  return null
}

export function detectEngineFromPort(port?: number): EngineDetectionResult | null {
  if (!port || !Number.isFinite(port)) return null
  switch (port) {
    case 5432:
      return { engine: 'postgres', confidence: 'medium', source: 'default-port', detail: 'Recognized PostgreSQL default port 5432', suggestedPort: 5432 }
    case 26257:
      return { engine: 'cockroachdb', confidence: 'medium', source: 'default-port', detail: 'Recognized CockroachDB default port 26257', suggestedPort: 26257 }
    case 3306:
      return { engine: 'mysql', confidence: 'medium', source: 'default-port', detail: 'Recognized MySQL/MariaDB default port 3306', suggestedPort: 3306 }
    case 1433:
      return { engine: 'mssql', confidence: 'medium', source: 'default-port', detail: 'Recognized SQL Server default port 1433', suggestedPort: 1433 }
    case 27017:
      return { engine: 'mongodb', confidence: 'medium', source: 'default-port', detail: 'Recognized MongoDB default port 27017', suggestedPort: 27017 }
    case 6379:
    case 6380:
      return { engine: 'redis', confidence: 'medium', source: 'default-port', detail: `Recognized Redis port ${port}`, suggestedPort: port, suggestedSSL: port === 6380 ? true : undefined }
    case 8123:
    case 8443:
      return { engine: 'clickhouse', confidence: 'medium', source: 'default-port', detail: `Recognized ClickHouse HTTP port ${port}`, suggestedPort: port, suggestedSSL: port === 8443 ? true : undefined }
    case 9042:
      return { engine: 'cassandra', confidence: 'medium', source: 'default-port', detail: 'Recognized Cassandra CQL port 9042', suggestedPort: 9042 }
    case 9200:
    case 9243:
      return { engine: 'elasticsearch', confidence: 'medium', source: 'default-port', detail: `Recognized Elasticsearch port ${port}`, suggestedPort: port, suggestedSSL: port === 9243 ? true : undefined }
    case 1521:
      return { engine: 'oracle', confidence: 'medium', source: 'default-port', detail: 'Recognized Oracle default port 1521', suggestedPort: 1521 }
    case 8086:
      return { engine: 'influxdb', confidence: 'medium', source: 'default-port', detail: 'Recognized InfluxDB port 8086', suggestedPort: 8086 }
    case 7474:
    case 7473:
    case 7687:
      return { engine: 'neo4j', confidence: 'medium', source: 'default-port', detail: `Recognized Neo4j port ${port}`, suggestedPort: port, suggestedSSL: port === 7473 ? true : undefined }
    default:
      return null
  }
}

export function detectEngineFromUri(rawUri?: string): EngineDetectionResult | null {
  const trimmed = rawUri?.trim()
  if (!trimmed) return null

  if (!trimmed.includes('://')) {
    return detectEngineFromFilePath(trimmed)
  }

  const any = parseAnyConnectionUri(trimmed)
  if (!any) return null

  const { scheme, parsed, filePath } = any
  const hostLower = parsed.host?.toLowerCase() ?? ''

  switch (scheme) {
    case 'postgres':
    case 'postgresql':
    case 'pg':
      if (parsed.port === 26257 || hostLower.includes('cockroach')) {
        return {
          engine: 'cockroachdb',
          confidence: 'high',
          source: 'uri-scheme',
          detail: `Recognized CockroachDB from URI (${scheme}:// on Cockroach endpoint)`,
          suggestedPort: parsed.port ?? 26257,
          suggestedSSL: parsed.ssl ?? (hostLower.includes('cockroachlabs.cloud') ? true : undefined),
          parsedUri: parsed
        }
      }
      return {
        engine: 'postgres',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized PostgreSQL from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 5432,
        suggestedSSL: parsed.ssl ?? ((hostLower.endsWith('.neon.tech') || hostLower.endsWith('.supabase.co') || hostLower.endsWith('.supabase.com')) ? true : undefined),
        parsedUri: parsed
      }

    case 'cockroachdb':
    case 'cockroach':
      return {
        engine: 'cockroachdb',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized CockroachDB from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 26257,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'mariadb':
      return {
        engine: 'mariadb',
        confidence: 'high',
        source: 'uri-scheme',
        detail: 'Recognized MariaDB from URI scheme mariadb://',
        suggestedPort: parsed.port ?? 3306,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'mysql':
    case 'mysql2':
      return {
        engine: 'mysql',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized MySQL from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 3306,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'mssql':
    case 'sqlserver':
    case 'tds':
      return {
        engine: 'mssql',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized SQL Server from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 1433,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'sqlite':
    case 'sqlite3':
      return {
        engine: 'sqlite',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized SQLite from URI scheme ${scheme}://`,
        parsedUri: parsed,
        filePath
      }

    case 'file':
      return filePath ? detectEngineFromFilePath(filePath) : null

    case 'mongodb':
    case 'mongodb+srv':
      return {
        engine: 'mongodb',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized MongoDB from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? (scheme === 'mongodb+srv' ? undefined : 27017),
        suggestedSSL: parsed.ssl ?? (scheme === 'mongodb+srv' ? true : undefined),
        parsedUri: parsed
      }

    case 'redis':
    case 'rediss':
      return {
        engine: 'redis',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized Redis from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 6379,
        suggestedSSL: parsed.ssl ?? (scheme === 'rediss' ? true : undefined),
        parsedUri: parsed
      }

    case 'clickhouse':
    case 'clickhouses':
      return {
        engine: 'clickhouse',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized ClickHouse from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? (scheme === 'clickhouses' ? 8443 : 8123),
        suggestedSSL: parsed.ssl ?? (scheme === 'clickhouses' ? true : undefined),
        parsedUri: parsed
      }

    case 'cassandra':
      return {
        engine: 'cassandra',
        confidence: 'high',
        source: 'uri-scheme',
        detail: 'Recognized Cassandra from URI scheme cassandra://',
        suggestedPort: parsed.port ?? 9042,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'elasticsearch':
    case 'es':
    case 'opensearch':
      return {
        engine: 'elasticsearch',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized Elasticsearch from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 9200,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'oracle':
    case 'oracle+thin':
      return {
        engine: 'oracle',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized Oracle from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 1521,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'influxdb':
    case 'influx':
      return {
        engine: 'influxdb',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized InfluxDB from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 8086,
        suggestedSSL: parsed.ssl,
        parsedUri: parsed
      }

    case 'neo4j':
    case 'neo4j+s':
    case 'neo4j+ssc':
    case 'bolt':
    case 'bolt+s':
    case 'bolt+ssc':
      return {
        engine: 'neo4j',
        confidence: 'high',
        source: 'uri-scheme',
        detail: `Recognized Neo4j from URI scheme ${scheme}://`,
        suggestedPort: parsed.port ?? 7474,
        suggestedSSL: parsed.ssl ?? (scheme.includes('+s') ? true : undefined),
        parsedUri: parsed
      }

    case 'snowflake':
      return {
        engine: 'snowflake',
        confidence: 'high',
        source: 'uri-scheme',
        detail: 'Recognized Snowflake from URI scheme snowflake://',
        suggestedSSL: true,
        parsedUri: parsed
      }

    case 'http':
    case 'https': {
      const ssl = scheme === 'https'
      const hostHint = detectEngineFromHostname(hostLower)
      if (hostHint) {
        return {
          ...hostHint,
          suggestedPort: parsed.port ?? hostHint.suggestedPort,
          suggestedSSL: ssl,
          parsedUri: parsed
        }
      }
      if (parsed.port) {
        const portHint = detectEngineFromPort(parsed.port)
        if (portHint && ['clickhouse', 'elasticsearch', 'influxdb', 'neo4j'].includes(portHint.engine)) {
          return {
            ...portHint,
            suggestedSSL: ssl,
            parsedUri: parsed
          }
        }
      }
      return null
    }

    default:
      return null
  }
}

export function detectEngineStatic(config: Partial<ConnectionConfig>): EngineDetectionResult | null {
  if (config.connectionUri?.trim()) {
    const uriMatch = detectEngineFromUri(config.connectionUri)
    if (uriMatch) return uriMatch
  }
  if (config.filename?.trim()) {
    const fileMatch = detectEngineFromFilePath(config.filename)
    if (fileMatch) return fileMatch
  }
  if (config.host?.trim()) {
    const hostMatch = detectEngineFromHostname(config.host)
    if (hostMatch) return hostMatch
  }
  if (config.port) {
    const portMatch = detectEngineFromPort(config.port)
    if (portMatch) return portMatch
  }
  return null
}

export function refineEngineFromServerVersion(
  version: string,
  currentType: DatabaseType
): EngineDetectionResult | null {
  const lower = version.trim().toLowerCase()
  if (!lower) return null

  if (currentType === 'mysql' && lower.includes('mariadb')) {
    return {
      engine: 'mariadb',
      confidence: 'high',
      source: 'server-version',
      detail: `Auto-recognized MariaDB from server version (${version})`
    }
  }
  if (currentType === 'mariadb' && !lower.includes('mariadb') && /^\d/.test(lower)) {
    return {
      engine: 'mysql',
      confidence: 'high',
      source: 'server-version',
      detail: `Auto-recognized MySQL from server version (${version})`
    }
  }
  if (currentType === 'postgres' && lower.includes('cockroachdb')) {
    return {
      engine: 'cockroachdb',
      confidence: 'high',
      source: 'server-version',
      detail: `Auto-recognized CockroachDB from server version (${version})`
    }
  }
  return null
}

export function applyDetectedEngineToConfig(
  config: ConnectionConfig,
  detection: EngineDetectionResult
): ConnectionConfig {
  const prevType = config.type
  const next: ConnectionConfig = {
    ...config,
    type: detection.engine
  }

  if (detection.parsedUri) {
    if (detection.parsedUri.host) next.host = detection.parsedUri.host
    if (detection.parsedUri.port !== undefined) next.port = detection.parsedUri.port
    if (detection.parsedUri.user) next.user = detection.parsedUri.user
    if (detection.parsedUri.password) next.password = detection.parsedUri.password
    if (detection.parsedUri.database) next.database = detection.parsedUri.database
    if (detection.parsedUri.ssl !== undefined) next.ssl = detection.parsedUri.ssl
  }

  if (detection.engine === 'sqlite') {
    if (detection.filePath) next.filename = detection.filePath
    next.port = undefined
    next.ssl = false
    next.connectionUri = undefined
  } else {
    if (detection.suggestedPort !== undefined) {
      if (next.port === undefined || next.port === ENGINE_DEFAULT_PORTS[prevType]) {
        next.port = detection.suggestedPort
      }
    } else if (next.port === undefined || next.port === ENGINE_DEFAULT_PORTS[prevType]) {
      next.port = ENGINE_DEFAULT_PORTS[detection.engine]
    }

    const prevDefaultUser = ENGINE_DEFAULT_USERS[prevType]
    if (!next.user?.trim() || (prevDefaultUser && next.user === prevDefaultUser)) {
      next.user = ENGINE_DEFAULT_USERS[detection.engine] ?? next.user
    }

    if (detection.suggestedSSL !== undefined) {
      next.ssl = detection.suggestedSSL
    }
  }

  return next
}

export function parseMySQLGreeting(buf: Buffer, port: number): EngineDetectionResult | null {
  if (buf.length < 10 || buf[3] !== 0x00 || buf[4] !== 0x0a) return null
  const nulIdx = buf.indexOf(0x00, 5)
  if (nulIdx < 0) return null
  const versionStr = buf.subarray(5, nulIdx).toString('utf8').trim()
  if (!versionStr) return null
  const isMaria = versionStr.toLowerCase().includes('mariadb')
  return {
    engine: isMaria ? 'mariadb' : 'mysql',
    confidence: 'high',
    source: 'wire-protocol',
    detail: `Detected ${isMaria ? 'MariaDB' : 'MySQL'} (${versionStr}) via wire handshake`,
    suggestedPort: port
  }
}

function tcpExchange(
  host: string,
  port: number,
  payload: Buffer | null,
  connectTimeoutMs: number,
  readTimeoutMs: number
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false
    const socket = new net.Socket()
    let readTimer: NodeJS.Timeout | null = null
    const connectTimer = setTimeout(() => finish(null), connectTimeoutMs)

    const finish = (data: Buffer | null) => {
      if (settled) return
      settled = true
      clearTimeout(connectTimer)
      if (readTimer) clearTimeout(readTimer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(data)
    }

    socket.once('error', () => finish(null))
    socket.once('close', () => finish(null))
    socket.once('data', (chunk) => finish(Buffer.from(chunk)))

    socket.connect(port, host, () => {
      clearTimeout(connectTimer)
      if (payload && payload.length > 0) {
        socket.write(payload)
      }
      readTimer = setTimeout(() => finish(null), readTimeoutMs)
    })
  })
}

function httpGet(
  host: string,
  port: number,
  reqPath: string,
  useHttps: boolean,
  timeoutMs: number
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string } | null> {
  return new Promise((resolve) => {
    const client = useHttps ? https : http
    let settled = false
    const done = (val: { status: number; headers: http.IncomingHttpHeaders; body: string } | null) => {
      if (settled) return
      settled = true
      resolve(val)
    }

    const req = client.request(
      {
        hostname: host,
        port,
        path: reqPath,
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false
      },
      (res) => {
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total <= 65536) chunks.push(chunk)
        })
        res.on('end', () => {
          done({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
        res.on('error', () => done(null))
      }
    )

    req.on('timeout', () => {
      req.destroy()
      done(null)
    })
    req.on('error', () => done(null))
    req.end()
  })
}

export async function probeEndpointEngine(
  host: string,
  port: number,
  ssl = false,
  timeoutMs = 2000
): Promise<EngineDetectionResult | null> {
  // 1. Server-first greeting (MySQL / MariaDB)
  const banner = await tcpExchange(host, port, null, timeoutMs, 350)
  if (banner) {
    const mysqlMatch = parseMySQLGreeting(banner, port)
    if (mysqlMatch) return mysqlMatch
  }

  // 2. PostgreSQL / CockroachDB SSLRequest packet
  const pgSSLRequest = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f])
  const pgReply = await tcpExchange(host, port, pgSSLRequest, timeoutMs, 450)
  if (pgReply && pgReply.length === 1 && (pgReply[0] === 0x53 || pgReply[0] === 0x4e)) {
    const isCockroach = port === 26257
    return {
      engine: isCockroach ? 'cockroachdb' : 'postgres',
      confidence: 'high',
      source: 'wire-protocol',
      detail: isCockroach
        ? `Detected CockroachDB (PostgreSQL wire protocol on port ${port})`
        : `Detected PostgreSQL wire protocol on ${host}:${port}`,
      suggestedPort: port,
      suggestedSSL: pgReply[0] === 0x53 ? undefined : false
    }
  }

  // 3. Redis RESP PING
  const redisReply = await tcpExchange(host, port, Buffer.from('PING\r\n', 'utf8'), timeoutMs, 450)
  if (redisReply) {
    const text = redisReply.toString('utf8')
    if (text.startsWith('+PONG') || text.startsWith('-NOAUTH') || text.startsWith('-WRONGPASS') || text.startsWith('-ERR')) {
      return {
        engine: 'redis',
        confidence: 'high',
        source: 'wire-protocol',
        detail: `Detected Redis RESP protocol on ${host}:${port}`,
        suggestedPort: port
      }
    }
  }

  // 4. Cassandra native v4 OPTIONS
  const casOptions = Buffer.from([0x04, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00])
  const casReply = await tcpExchange(host, port, casOptions, timeoutMs, 450)
  if (casReply && casReply.length >= 5 && (casReply[0] & 0x80) !== 0 && casReply[4] === 0x06) {
    return {
      engine: 'cassandra',
      confidence: 'high',
      source: 'wire-protocol',
      detail: `Detected Apache Cassandra CQL protocol on ${host}:${port}`,
      suggestedPort: port
    }
  }

  // 5. HTTP-based database engines (Elasticsearch, ClickHouse, InfluxDB, Neo4j)
  const useHttps = ssl || port === 443 || port === 8443 || port === 9243 || port === 7473
  const rootRes = await httpGet(host, port, '/', useHttps, timeoutMs)
  if (rootRes) {
    if (rootRes.headers['x-elastic-product']) {
      return {
        engine: 'elasticsearch',
        confidence: 'high',
        source: 'http-probe',
        detail: `Detected Elasticsearch via HTTP header on ${host}:${port}`,
        suggestedPort: port,
        suggestedSSL: useHttps
      }
    }
    if (rootRes.headers['x-clickhouse-summary'] || rootRes.headers['x-clickhouse-server-display-name']) {
      return {
        engine: 'clickhouse',
        confidence: 'high',
        source: 'http-probe',
        detail: `Detected ClickHouse HTTP interface on ${host}:${port}`,
        suggestedPort: port,
        suggestedSSL: useHttps
      }
    }
    if (rootRes.headers['x-influxdb-version'] || rootRes.headers['x-influxdb-build']) {
      return {
        engine: 'influxdb',
        confidence: 'high',
        source: 'http-probe',
        detail: `Detected InfluxDB via HTTP header on ${host}:${port}`,
        suggestedPort: port,
        suggestedSSL: useHttps
      }
    }
    try {
      const json = JSON.parse(rootRes.body) as Record<string, unknown>
      if (json && typeof json === 'object') {
        if ('cluster_name' in json && 'version' in json) {
          return {
            engine: 'elasticsearch',
            confidence: 'high',
            source: 'http-probe',
            detail: `Detected Elasticsearch cluster on ${host}:${port}`,
            suggestedPort: port,
            suggestedSSL: useHttps
          }
        }
        if ('neo4j_version' in json || 'bolt_direct' in json || 'transaction' in json) {
          return {
            engine: 'neo4j',
            confidence: 'high',
            source: 'http-probe',
            detail: `Detected Neo4j HTTP endpoint on ${host}:${port}`,
            suggestedPort: port,
            suggestedSSL: useHttps
          }
        }
      }
    } catch {
      // Not JSON
    }
  }

  const pingRes = await httpGet(host, port, '/ping', useHttps, timeoutMs)
  if (pingRes) {
    if (pingRes.headers['x-influxdb-version'] || pingRes.headers['x-influxdb-build']) {
      return {
        engine: 'influxdb',
        confidence: 'high',
        source: 'http-probe',
        detail: `Detected InfluxDB via /ping header on ${host}:${port}`,
        suggestedPort: port,
        suggestedSSL: useHttps
      }
    }
    if (pingRes.body.trim() === 'Ok.') {
      return {
        engine: 'clickhouse',
        confidence: 'high',
        source: 'http-probe',
        detail: `Detected ClickHouse via /ping response on ${host}:${port}`,
        suggestedPort: port,
        suggestedSSL: useHttps
      }
    }
  }

  const healthRes = await httpGet(host, port, '/health', useHttps, timeoutMs)
  if (healthRes) {
    try {
      const json = JSON.parse(healthRes.body) as Record<string, unknown>
      if (typeof json?.name === 'string' && json.name.toLowerCase().includes('influx')) {
        return {
          engine: 'influxdb',
          confidence: 'high',
          source: 'http-probe',
          detail: `Detected InfluxDB via /health endpoint on ${host}:${port}`,
          suggestedPort: port,
          suggestedSSL: useHttps
        }
      }
    } catch {
      // Not JSON
    }
  }

  return null
}

export async function probeDatabaseEngine(
  config: Partial<ConnectionConfig>,
  timeoutMs = 2000
): Promise<EngineDetectionResult | null> {
  if (config.filename?.trim()) {
    const fileMatch = detectEngineFromFilePath(config.filename)
    if (fileMatch) return fileMatch
  }

  let host = config.host?.trim() ?? ''
  let port = config.port
  let ssl = Boolean(config.ssl)
  let staticUriMatch: EngineDetectionResult | null = null

  if (config.connectionUri?.trim()) {
    staticUriMatch = detectEngineFromUri(config.connectionUri)
    if (staticUriMatch?.filePath) {
      return detectEngineFromFilePath(staticUriMatch.filePath) ?? staticUriMatch
    }
    const any = parseAnyConnectionUri(config.connectionUri)
    if (any) {
      if (any.parsed.host) host = any.parsed.host
      if (any.parsed.port !== undefined) port = any.parsed.port
      if (any.parsed.ssl !== undefined) ssl = any.parsed.ssl
    }
  }

  const effectiveHost = host || '127.0.0.1'
  const effectivePort = port ?? staticUriMatch?.suggestedPort ?? (config.type ? ENGINE_DEFAULT_PORTS[config.type] : undefined)

  if (effectivePort && effectivePort > 0) {
    const live = await probeEndpointEngine(effectiveHost, effectivePort, ssl, timeoutMs)
    if (live) {
      return {
        ...live,
        parsedUri: staticUriMatch?.parsedUri ?? live.parsedUri
      }
    }
  }

  return staticUriMatch ?? detectEngineStatic(config)
}
