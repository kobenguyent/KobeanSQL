import type { DatabaseType } from '../types'

export interface ParsedConnectionUriPreview {
  host?: string
  port?: number
  user?: string
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
