import type { ConnectionConfig, DatabaseType } from './types'

export interface ParsedUriConfig {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean
}

export interface AnyParsedUriConfig {
  scheme: string
  parsed: ParsedUriConfig
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

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseAnyConnectionUri(connectionUri?: string): AnyParsedUriConfig | null {
  const raw = connectionUri?.trim()
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  const scheme = parsed.protocol.replace(':', '').toLowerCase()
  let filePath: string | undefined
  if (scheme === 'sqlite' || scheme === 'sqlite3' || scheme === 'file') {
    const combined = parsed.hostname ? `/${parsed.hostname}${parsed.pathname}` : parsed.pathname
    if (combined) {
      filePath = decodePart(combined)
    }
  }

  const pathDb = parsed.pathname.replace(/^\/+/, '')
  const sslQuery = parsed.searchParams.get('ssl') ?? parsed.searchParams.get('sslmode')
  const encryptQuery = parsed.searchParams.get('encrypt')

  const normalized: ParsedUriConfig = {
    host: parsed.hostname || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.username ? decodePart(parsed.username) : undefined,
    password: parsed.password ? decodePart(parsed.password) : undefined,
    database: pathDb ? decodePart(pathDb) : undefined
  }

  if (sslQuery) {
    const sslValue = sslQuery.toLowerCase()
    normalized.ssl = sslValue !== 'disable' && sslValue !== 'false' && sslValue !== '0'
  } else if (encryptQuery) {
    const encValue = encryptQuery.toLowerCase()
    normalized.ssl = encValue === 'true' || encValue === '1' || encValue === 'yes'
  } else if (['https', 'rediss', 'clickhouses', 'neo4j+s', 'neo4j+ssc', 'bolt+s', 'bolt+ssc'].includes(scheme)) {
    normalized.ssl = true
  }

  return { scheme, parsed: normalized, filePath }
}

export function parseConnectionUri(type: DatabaseType, connectionUri?: string): ParsedUriConfig | null {
  const raw = connectionUri?.trim()
  if (!raw) return null

  const any = parseAnyConnectionUri(raw)
  if (!any) {
    throw new Error('Invalid connection URI format')
  }

  const allowed = ALLOWED_SCHEMES[type] ?? []
  if (!allowed.includes(any.scheme)) {
    throw new Error(`Invalid URI scheme for ${type}. Allowed: ${allowed.join(', ')}`)
  }

  return any.parsed
}

export function resolveConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  const parsed = parseConnectionUri(config.type, config.connectionUri)
  if (!parsed) return config

  return {
    ...config,
    host: parsed.host ?? config.host,
    port: parsed.port ?? config.port,
    user: parsed.user ?? config.user,
    password: parsed.password ?? config.password,
    database: parsed.database ?? config.database,
    ssl: parsed.ssl ?? config.ssl
  }
}
