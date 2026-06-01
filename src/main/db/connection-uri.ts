import type { ConnectionConfig, DatabaseType } from './types'

interface ParsedUriConfig {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean
}

const ALLOWED_SCHEMES: Record<DatabaseType, string[]> = {
  postgres: ['postgres', 'postgresql'],
  mysql: ['mysql'],
  mariadb: ['mariadb', 'mysql'],
  mssql: ['mssql', 'sqlserver'],
  sqlite: ['sqlite'],
  mongodb: ['mongodb', 'mongodb+srv']
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseConnectionUri(type: DatabaseType, connectionUri?: string): ParsedUriConfig | null {
  const raw = connectionUri?.trim()
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid connection URI format')
  }

  const scheme = parsed.protocol.replace(':', '').toLowerCase()
  const allowed = ALLOWED_SCHEMES[type] ?? []
  if (!allowed.includes(scheme)) {
    throw new Error(`Invalid URI scheme for ${type}. Allowed: ${allowed.join(', ')}`)
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
  }

  return normalized
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
