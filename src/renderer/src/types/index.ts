export type DatabaseType = 'mysql' | 'mariadb' | 'postgres' | 'sqlite' | 'mssql' | 'mongodb'

export interface ConnectionConfig {
  id: string
  name: string
  type: DatabaseType
  connectionUri?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  filename?: string
  ssl?: boolean
  color?: string
  category?: string
}

export interface QueryResult {
  columns: ColumnDef[]
  rows: Record<string, unknown>[]
  rowCount: number
  duration: number
  error?: string
}

export interface ColumnDef {
  name: string
  type: string
  nullable?: boolean
  primaryKey?: boolean
}

export interface TableInfo {
  name: string
  type: 'table' | 'view'
  schema?: string
}

export interface ProcedureInfo {
  name: string
  schema?: string
  type: 'procedure' | 'function'
  /** Unique identifier for overloaded routines (e.g. Postgres specific_name) */
  specificName?: string
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
  comment?: string
}

export interface QueryTab {
  id: string
  title: string
  tabType: 'query' | 'table' | 'procedure'
  tabColor?: string
  groupTitle?: string
  groupColor?: string
  connectionId: string | null
  sql: string
  result: QueryResult | null
  isRunning: boolean
  isSaved: boolean
  lastSavedSql?: string
  database?: string
  schema?: string
}

export interface SavedQuery {
  id: string
  name: string
  sql: string
  createdAt: number
  category?: string
}

export interface QueryHistoryEntry {
  id: string
  sql: string
  connectionId: string | null
  connectionName: string
  timestamp: number
  duration: number
  rowCount: number
  error?: string
}

export interface AppSettings {
  queryLimit: number
  updates: {
    autoCheckEnabled: boolean
    checkIntervalHours: number
    ignoredVersion?: string
    dismissedVersion?: string
    dismissedAt?: number
    cache: {
      etag?: string
      latestVersion?: string
      releaseUrl?: string
      releaseName?: string
      checkedAt?: number
      downloadUrl?: string
    }
  }
  ai?: {
    provider: 'ollama' | 'openai-compatible'
    baseUrl: string
    model: string
  }
  language?: string
}

export interface UpdateStatus {
  checking: boolean
  enabled: boolean
  intervalHours: number
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  releaseName?: string
  lastCheckedAt?: number
  ignoredVersion?: string
  dismissedVersion?: string
  dismissedAt?: number
  updateAvailable: boolean
  shouldNotify: boolean
  error?: string
  downloadState?: 'idle' | 'downloading' | 'ready' | 'error'
  downloadProgress?: number
  downloadError?: string
}

export const DB_COLORS: Record<DatabaseType, string> = {
  mysql: '#f97316',
  mariadb: '#c084fc',
  postgres: '#60a5fa',
  sqlite: '#4ade80',
  mssql: '#f87171',
  mongodb: '#10b981'
}

export const DB_DEFAULT_PORTS: Record<DatabaseType, number | undefined> = {
  mysql: 3306,
  mariadb: 3306,
  postgres: 5432,
  sqlite: undefined,
  mssql: 1433,
  mongodb: 27017
}
