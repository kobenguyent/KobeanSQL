import type { DatabaseType } from '../types'

export interface ParsedConnectionUriPreview {
  host?: string
  port?: number
  user?: string
  database?: string
  ssl?: boolean
}

export interface RendererEngineDetection {
  engine: DatabaseType
  detail: string
  suggestedPort?: number
  suggestedSSL?: boolean
  filePath?: string
}

const ALLOWED_SCHEMES: Record<DatabaseType, string[]> = {
  postgres: ['postgres', 'postgresql', 'pg'],
  mysql: ['mysql', 'mysql2'],
  mariadb: ['mariadb', 'mysql', 'mysql2'],
  mssql: ['mssql', 'sqlserver', 'tds'],
  sqlite: ['sqlite', 'sqlite3', 'file'],
  mongodb: ['mongodb', 'mongodb+srv'],
  cockroachdb: ['cockroachdb', 'cockroach', 'postgres', 'postgresql'],
  clickhouse: ['clickhouse', 'clickhouses', 'http', 'https'],
  cassandra: ['cassandra'],
  redis: ['redis', 'rediss'],
  elasticsearch: ['http', 'https', 'elasticsearch', 'es', 'opensearch'],
  oracle: ['oracle', 'oracle+thin'],
  influxdb: ['http', 'https', 'influxdb', 'influx'],
  neo4j: ['http', 'https', 'neo4j', 'neo4j+s', 'neo4j+ssc', 'bolt', 'bolt+s', 'bolt+ssc'],
  snowflake: ['snowflake', 'https']
}

const SQLITE_EXT_RE = /\.(sqlite3?|db|s3db|sl3)$/i

export function detectEngineFromHostname(rawHost?: string): RendererEngineDetection | null {
  const host = rawHost?.trim().toLowerCase()
  if (!host) return null

  if (host.includes('snowflakecomputing.com')) {
    return { engine: 'snowflake', detail: 'Recognized Snowflake hostname', suggestedSSL: true }
  }
  if (host.includes('cockroachlabs.cloud') || host.includes('cockroach')) {
    return { engine: 'cockroachdb', detail: 'Recognized CockroachDB hostname', suggestedPort: 26257, suggestedSSL: host.includes('cockroachlabs.cloud') ? true : undefined }
  }
  if (host.includes('mongodb.net') || host.includes('mongodb.com')) {
    return { engine: 'mongodb', detail: 'Recognized MongoDB Atlas hostname', suggestedPort: 27017, suggestedSSL: true }
  }
  if (host.includes('clickhouse.cloud') || host.includes('clickhouse')) {
    return { engine: 'clickhouse', detail: 'Recognized ClickHouse hostname', suggestedPort: host.includes('clickhouse.cloud') ? 8443 : 8123, suggestedSSL: host.includes('clickhouse.cloud') ? true : undefined }
  }
  if (host.includes('influxdata.com') || host.includes('influxdb')) {
    return { engine: 'influxdb', detail: 'Recognized InfluxDB hostname', suggestedPort: 8086, suggestedSSL: host.includes('influxdata.com') ? true : undefined }
  }
  if (host.includes('databases.neo4j.io') || host.includes('neo4j')) {
    return { engine: 'neo4j', detail: 'Recognized Neo4j hostname', suggestedPort: 7474, suggestedSSL: host.includes('neo4j.io') ? true : undefined }
  }
  if (host.includes('elastic-cloud.com') || host.includes('es.amazonaws.com') || host.includes('elasticsearch')) {
    return { engine: 'elasticsearch', detail: 'Recognized Elasticsearch hostname', suggestedPort: 9200, suggestedSSL: host.includes('elastic-cloud.com') ? true : undefined }
  }
  if (host.includes('upstash.io') || host.includes('redislabs.com') || host.includes('redis.cache.windows.net') || host.includes('cache.amazonaws.com')) {
    return { engine: 'redis', detail: 'Recognized Redis cloud hostname', suggestedPort: 6379, suggestedSSL: true }
  }
  if (host.includes('database.windows.net')) {
    return { engine: 'mssql', detail: 'Recognized Azure SQL Server hostname', suggestedPort: 1433, suggestedSSL: true }
  }
  if (host.includes('neon.tech') || host.includes('supabase.co') || host.includes('supabase.com')) {
    return { engine: 'postgres', detail: 'Recognized managed PostgreSQL hostname', suggestedPort: 5432, suggestedSSL: true }
  }
  return null
}

export function detectEngineFromPort(port?: number): RendererEngineDetection | null {
  if (!port || !Number.isFinite(port)) return null
  switch (port) {
    case 5432: return { engine: 'postgres', detail: 'Recognized PostgreSQL default port 5432', suggestedPort: 5432 }
    case 26257: return { engine: 'cockroachdb', detail: 'Recognized CockroachDB default port 26257', suggestedPort: 26257 }
    case 3306: return { engine: 'mysql', detail: 'Recognized MySQL/MariaDB default port 3306', suggestedPort: 3306 }
    case 1433: return { engine: 'mssql', detail: 'Recognized SQL Server default port 1433', suggestedPort: 1433 }
    case 27017: return { engine: 'mongodb', detail: 'Recognized MongoDB default port 27017', suggestedPort: 27017 }
    case 6379:
    case 6380: return { engine: 'redis', detail: `Recognized Redis port ${port}`, suggestedPort: port, suggestedSSL: port === 6380 ? true : undefined }
    case 8123:
    case 8443: return { engine: 'clickhouse', detail: `Recognized ClickHouse port ${port}`, suggestedPort: port, suggestedSSL: port === 8443 ? true : undefined }
    case 9042: return { engine: 'cassandra', detail: 'Recognized Cassandra port 9042', suggestedPort: 9042 }
    case 9200:
    case 9243: return { engine: 'elasticsearch', detail: `Recognized Elasticsearch port ${port}`, suggestedPort: port, suggestedSSL: port === 9243 ? true : undefined }
    case 1521: return { engine: 'oracle', detail: 'Recognized Oracle port 1521', suggestedPort: 1521 }
    case 8086: return { engine: 'influxdb', detail: 'Recognized InfluxDB port 8086', suggestedPort: 8086 }
    case 7474:
    case 7473:
    case 7687: return { engine: 'neo4j', detail: `Recognized Neo4j port ${port}`, suggestedPort: port, suggestedSSL: port === 7473 ? true : undefined }
    default: return null
  }
}

export function detectEngineFromInput(input: {
  connectionUri?: string
  host?: string
  port?: number
  filename?: string
}): RendererEngineDetection | null {
  const uri = input.connectionUri?.trim()
  if (uri) {
    if (!uri.includes('://')) {
      if (uri === ':memory:' || SQLITE_EXT_RE.test(uri)) {
        return { engine: 'sqlite', detail: 'Recognized SQLite database file path', filePath: uri }
      }
    } else {
      try {
        const parsed = new URL(uri)
        const scheme = parsed.protocol.replace(':', '').toLowerCase()
        const hostLower = parsed.hostname.toLowerCase()
        const port = parsed.port ? Number(parsed.port) : undefined
        switch (scheme) {
          case 'postgres':
          case 'postgresql':
          case 'pg':
            if (port === 26257 || hostLower.includes('cockroach')) {
              return { engine: 'cockroachdb', detail: `Recognized CockroachDB from ${scheme}:// URI`, suggestedPort: port ?? 26257 }
            }
            return { engine: 'postgres', detail: `Recognized PostgreSQL from ${scheme}:// URI`, suggestedPort: port ?? 5432 }
          case 'cockroachdb':
          case 'cockroach':
            return { engine: 'cockroachdb', detail: `Recognized CockroachDB from ${scheme}:// URI`, suggestedPort: port ?? 26257 }
          case 'mariadb':
            return { engine: 'mariadb', detail: 'Recognized MariaDB from mariadb:// URI', suggestedPort: port ?? 3306 }
          case 'mysql':
          case 'mysql2':
            return { engine: 'mysql', detail: `Recognized MySQL from ${scheme}:// URI`, suggestedPort: port ?? 3306 }
          case 'mssql':
          case 'sqlserver':
          case 'tds':
            return { engine: 'mssql', detail: `Recognized SQL Server from ${scheme}:// URI`, suggestedPort: port ?? 1433 }
          case 'sqlite':
          case 'sqlite3': {
            const fp = parsed.hostname ? `/${parsed.hostname}${parsed.pathname}` : parsed.pathname
            return { engine: 'sqlite', detail: `Recognized SQLite from ${scheme}:// URI`, filePath: fp || undefined }
          }
          case 'file': {
            const fp = parsed.hostname ? `/${parsed.hostname}${parsed.pathname}` : parsed.pathname
            if (SQLITE_EXT_RE.test(fp)) {
              return { engine: 'sqlite', detail: 'Recognized SQLite from file:// URI', filePath: fp }
            }
            break
          }
          case 'mongodb':
          case 'mongodb+srv':
            return { engine: 'mongodb', detail: `Recognized MongoDB from ${scheme}:// URI`, suggestedPort: port ?? (scheme === 'mongodb+srv' ? undefined : 27017), suggestedSSL: scheme === 'mongodb+srv' ? true : undefined }
          case 'redis':
          case 'rediss':
            return { engine: 'redis', detail: `Recognized Redis from ${scheme}:// URI`, suggestedPort: port ?? 6379, suggestedSSL: scheme === 'rediss' ? true : undefined }
          case 'clickhouse':
          case 'clickhouses':
            return { engine: 'clickhouse', detail: `Recognized ClickHouse from ${scheme}:// URI`, suggestedPort: port ?? (scheme === 'clickhouses' ? 8443 : 8123), suggestedSSL: scheme === 'clickhouses' ? true : undefined }
          case 'cassandra':
            return { engine: 'cassandra', detail: 'Recognized Cassandra from cassandra:// URI', suggestedPort: port ?? 9042 }
          case 'elasticsearch':
          case 'es':
          case 'opensearch':
            return { engine: 'elasticsearch', detail: `Recognized Elasticsearch from ${scheme}:// URI`, suggestedPort: port ?? 9200 }
          case 'oracle':
          case 'oracle+thin':
            return { engine: 'oracle', detail: `Recognized Oracle from ${scheme}:// URI`, suggestedPort: port ?? 1521 }
          case 'influxdb':
          case 'influx':
            return { engine: 'influxdb', detail: `Recognized InfluxDB from ${scheme}:// URI`, suggestedPort: port ?? 8086 }
          case 'neo4j':
          case 'neo4j+s':
          case 'neo4j+ssc':
          case 'bolt':
          case 'bolt+s':
          case 'bolt+ssc':
            return { engine: 'neo4j', detail: `Recognized Neo4j from ${scheme}:// URI`, suggestedPort: port ?? 7474, suggestedSSL: scheme.includes('+s') ? true : undefined }
          case 'snowflake':
            return { engine: 'snowflake', detail: 'Recognized Snowflake from snowflake:// URI', suggestedSSL: true }
          case 'http':
          case 'https': {
            const hostMatch = detectEngineFromHostname(hostLower)
            if (hostMatch) return { ...hostMatch, suggestedSSL: scheme === 'https' }
            const portMatch = detectEngineFromPort(port)
            if (portMatch && ['clickhouse', 'elasticsearch', 'influxdb', 'neo4j'].includes(portMatch.engine)) {
              return { ...portMatch, suggestedSSL: scheme === 'https' }
            }
            break
          }
        }
      } catch {
        // Ignore partial URI while typing
      }
    }
  }

  if (input.filename?.trim()) {
    const f = input.filename.trim()
    if (f === ':memory:' || SQLITE_EXT_RE.test(f)) {
      return { engine: 'sqlite', detail: 'Recognized SQLite database file', filePath: f }
    }
  }

  const hostMatch = detectEngineFromHostname(input.host)
  if (hostMatch) return hostMatch

  return detectEngineFromPort(input.port)
}

export function parseConnectionUriPreview(
  type: DatabaseType,
  connectionUri?: string
): { parsed?: ParsedConnectionUriPreview; error?: string } {
  const raw = connectionUri?.trim()
  if (!raw) return {}

  let parsedUrl: URL
  try {
    parsedUrl = new URL(raw)
  } catch {
    return { error: 'Invalid connection URI format' }
  }

  const scheme = parsedUrl.protocol.replace(':', '').toLowerCase()
  const allowed = ALLOWED_SCHEMES[type] ?? []
  if (!allowed.includes(scheme)) {
    return { error: `Invalid URI scheme for ${type}. Allowed: ${allowed.join(', ')}` }
  }

  const pathDb = parsedUrl.pathname.replace(/^\/+/, '')
  const sslQuery = parsedUrl.searchParams.get('ssl') ?? parsedUrl.searchParams.get('sslmode')
  const encryptQuery = parsedUrl.searchParams.get('encrypt')

  let ssl: boolean | undefined
  if (sslQuery) {
    const v = sslQuery.toLowerCase()
    ssl = v !== 'disable' && v !== 'false' && v !== '0'
  } else if (encryptQuery) {
    const v = encryptQuery.toLowerCase()
    ssl = v === 'true' || v === '1' || v === 'yes'
  } else if (['https', 'rediss', 'clickhouses', 'neo4j+s', 'neo4j+ssc', 'bolt+s', 'bolt+ssc'].includes(scheme)) {
    ssl = true
  }

  return {
    parsed: {
      host: parsedUrl.hostname || undefined,
      port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
      user: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
      database: pathDb ? decodeURIComponent(pathDb) : undefined,
      ssl
    }
  }
}
