import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { ConnectionConfig, DatabaseType } from './db/types'
import { appLogger } from './logger'
import { MigrationManager } from './migration'
import { localStore } from './local-store'


export interface SavedQueryRecord {
  id: string
  name: string
  sql: string
  createdAt: number
  category?: string
}

export interface AIStoredSettings {
  provider: 'ollama' | 'openai-compatible'
  baseUrl: string
  model: string
}

export interface AppSettings {
  queryLimit: number
  updates: UpdateSettings
  ai?: AIStoredSettings
  language?: string
}

export interface UpdateSettings {
  autoCheckEnabled: boolean
  checkIntervalHours: number
  ignoredVersion?: string
  dismissedVersion?: string
  dismissedAt?: number
  cache: UpdateCheckCache
}

export interface UpdateCheckCache {
  etag?: string
  latestVersion?: string
  releaseUrl?: string
  releaseName?: string
  checkedAt?: number
  downloadUrl?: string
}

const DEFAULT_SETTINGS: AppSettings = {
  queryLimit: 100,
  updates: {
    autoCheckEnabled: true,
    checkIntervalHours: 24,
    cache: {}
  }
}
const MIN_QUERY_LIMIT = 1
const MAX_QUERY_LIMIT = 10000
const MIN_UPDATE_INTERVAL_HOURS = 6
const MAX_UPDATE_INTERVAL_HOURS = 168

function getDefaultSettings(): AppSettings {
  return {
    queryLimit: 100,
    updates: {
      autoCheckEnabled: true,
      checkIntervalHours: 24,
      cache: {}
    }
  }
}

const getStorePath = (): string => path.join(app.getPath('userData'), 'connections.json')
const getSavedQueriesPath = (): string => path.join(app.getPath('userData'), 'saved-queries.json')
const SUPPORTED_DB_TYPES: DatabaseType[] = ['mysql', 'mariadb', 'postgres', 'sqlite', 'mssql', 'mongodb']
const getSettingsPath = (): string => path.join(app.getPath('userData'), 'settings.json')

/** Prefix used to distinguish safeStorage-encrypted values from plaintext. */
const ENCRYPTED_PREFIX = 'enc:'

function encryptPassword(password: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return ENCRYPTED_PREFIX + safeStorage.encryptString(password).toString('base64')
  }
  return password
}

function decryptPassword(stored: string): string | undefined {
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    try {
      const buf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return undefined
    }
  }
  // Legacy plaintext value — return as-is so existing data keeps working.
  return stored
}

export async function performMigrations(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const migrationManager = new MigrationManager(userDataPath)

  // Connections migration
  await migrationManager.migrateJson('connections.json', [
    {
      version: 1,
      up: () => {
        // Version 1 is the baseline (array wrapped into object)
      }
    }
  ])

  // Settings migration
  await migrationManager.migrateJson('settings.json', [
    {
      version: 1,
      up: () => {
        // Version 1 is the baseline
      }
    }
  ])
}

export function loadConnections(): ConnectionConfig[] {
  try {
    const raw = loadPersistedConnectionsRaw()
    return raw.map((c) => ({
      ...c,
      password: c.password ? decryptPassword(c.password) : c.password
    }))
  } catch {
    return []
  }
}

export function saveConnections(connections: ConnectionConfig[]): void {
  try {
    const storePath = getStorePath()
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    const persisted = connections.map((c) => ({
      ...c,
      password: c.password ? encryptPassword(c.password) : c.password
    }))
    const payload = {
      version: 1,
      connections: persisted
    }
    fs.writeFileSync(storePath, JSON.stringify(payload, null, 2), 'utf-8')
  } catch (err) {
    appLogger.error('Failed to save connections', { error: (err as Error).message })
  }
}

export function loadSavedQueries(): SavedQueryRecord[] {
  return localStore.getSavedQueries()
}

export function writeSavedQueries(queries: SavedQueryRecord[]): void {
  // To keep SQLite in sync with the provided list (including deletions),
  // we could either clear and re-insert, or implement a more surgical sync.
  // For saved queries (usually < 1000 items), clear-and-reinsert is safest and fast.
  const existing = localStore.getSavedQueries()
  const incomingIds = new Set(queries.map(q => q.id))
  
  // Remove items not in the incoming list
  for (const q of existing) {
    if (!incomingIds.has(q.id)) {
      localStore.deleteSavedQuery(q.id)
    }
  }

  // Insert or update incoming items
  for (const q of queries) {
    localStore.addSavedQuery(q)
  }
}

export function deleteSavedQuery(id: string): void {
  localStore.deleteSavedQuery(id)
}

export interface ImportConnectionsResult {
  imported: number
  replaced: number
  skippedDuplicates: number
  skippedInvalid: number
}

export function loadPersistedConnectionsRaw(): ConnectionConfig[] {
  const storePath = getStorePath()
  if (!fs.existsSync(storePath)) return []
  const data = fs.readFileSync(storePath, 'utf-8')
  const parsed = JSON.parse(data)
  if (Array.isArray(parsed)) return parsed as ConnectionConfig[]
  return (parsed as { connections?: ConnectionConfig[] }).connections ?? []
}

export function exportConnectionsToPath(exportPath: string, includePasswords = false): number {
  const baseConnections = includePasswords
    ? loadPersistedConnectionsRaw()
    : loadConnections().map((conn) => ({ ...conn, password: undefined }))

  const payload = {
    version: 1,
    exportedAt: Date.now(),
    includePasswords,
    connections: baseConnections
  }
  fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2), 'utf-8')
  return baseConnections.length
}

export function importConnectionsFromPath(importPath: string): ImportConnectionsResult {
  const rawData = fs.readFileSync(importPath, 'utf-8')
  const parsed = JSON.parse(rawData) as { connections?: unknown } | ConnectionConfig[]
  const incomingList = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { connections?: unknown }).connections)
      ? ((parsed as { connections: ConnectionConfig[] }).connections ?? [])
      : []

  const existing = loadConnections()
  let imported = 0
  let replaced = 0
  let skippedDuplicates = 0
  let skippedInvalid = 0

  for (const incoming of incomingList) {
    if (!isValidConnectionConfig(incoming)) {
      skippedInvalid += 1
      continue
    }

    const normalized = normalizeImportedConnection(incoming)
    const indexById = existing.findIndex((conn) => conn.id === normalized.id)
    if (indexById >= 0) {
      existing[indexById] = normalized
      replaced += 1
      continue
    }

    const duplicateByFingerprint = existing.some((conn) => fingerprintConnection(conn) === fingerprintConnection(normalized))
    if (duplicateByFingerprint) {
      skippedDuplicates += 1
      continue
    }

    existing.push(normalized)
    imported += 1
  }

  saveConnections(existing)
  return { imported, replaced, skippedDuplicates, skippedInvalid }
}

function isValidConnectionConfig(value: unknown): value is ConnectionConfig {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record['name'] !== 'string' || !record['name'].trim()) return false
  if (typeof record['type'] !== 'string' || !SUPPORTED_DB_TYPES.includes(record['type'] as DatabaseType)) return false
  if (record['id'] !== undefined && typeof record['id'] !== 'string') return false
  return true
}

function normalizeImportedConnection(conn: ConnectionConfig): ConnectionConfig {
  return {
    ...conn,
    id: conn.id?.trim() || createConnectionId(),
    name: conn.name.trim(),
    connectionUri: conn.connectionUri?.trim() || undefined,
    password: sanitizeImportedPassword(conn.password),
    category: conn.category?.trim() || undefined
  }
}

function createConnectionId(): string {
  return randomUUID()
}

function sanitizeImportedPassword(password?: string): string | undefined {
  if (!password) return undefined
  if (!password.startsWith(ENCRYPTED_PREFIX)) {
    return password
  }
  const decrypted = decryptPassword(password)
  if (!decrypted) {
    appLogger.warn('Dropped invalid encrypted password during import')
    return undefined
  }
  // Always re-encrypt using local machine key material on save.
  return decrypted
}

function fingerprintConnection(conn: ConnectionConfig): string {
  return JSON.stringify({
    type: conn.type,
    name: conn.name.trim().toLowerCase(),
    connectionUri: conn.connectionUri?.trim().toLowerCase() ?? '',
    host: conn.host?.trim().toLowerCase() ?? '',
    port: conn.port?.toString() ?? '',
    user: conn.user?.trim().toLowerCase() ?? '',
    database: conn.database?.trim().toLowerCase() ?? '',
    filename: conn.filename?.trim().toLowerCase() ?? ''
  })
}

export function loadSettings(): AppSettings {
  try {
    const p = getSettingsPath()
    if (!fs.existsSync(p)) return getDefaultSettings()
    const data = fs.readFileSync(p, 'utf-8')
    return sanitizeSettings(JSON.parse(data) as unknown)
  } catch {
    return getDefaultSettings()
  }
}

function sanitizeQueryLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.queryLimit
  return Math.max(MIN_QUERY_LIMIT, Math.min(MAX_QUERY_LIMIT, Math.floor(n)))
}

function sanitizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function sanitizeTimestamp(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

function sanitizeUpdateIntervalHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.updates.checkIntervalHours
  return Math.max(MIN_UPDATE_INTERVAL_HOURS, Math.min(MAX_UPDATE_INTERVAL_HOURS, Math.floor(n)))
}

function sanitizeUpdateCache(value: unknown): UpdateCheckCache {
  if (!value || typeof value !== 'object') return {}
  const source = value as UpdateCheckCache
  return {
    etag: sanitizeOptionalString(source.etag),
    latestVersion: sanitizeOptionalString(source.latestVersion),
    releaseUrl: sanitizeOptionalString(source.releaseUrl),
    releaseName: sanitizeOptionalString(source.releaseName),
    checkedAt: sanitizeTimestamp(source.checkedAt),
    downloadUrl: sanitizeOptionalString(source.downloadUrl)
  }
}

function sanitizeUpdateSettings(value: unknown): UpdateSettings {
  const fallback = DEFAULT_SETTINGS.updates
  if (!value || typeof value !== 'object') {
    return { ...fallback, cache: { ...fallback.cache } }
  }
  const source = value as Partial<UpdateSettings>
  return {
    autoCheckEnabled: typeof source.autoCheckEnabled === 'boolean' ? source.autoCheckEnabled : fallback.autoCheckEnabled,
    checkIntervalHours: sanitizeUpdateIntervalHours(source.checkIntervalHours),
    ignoredVersion: sanitizeOptionalString(source.ignoredVersion),
    dismissedVersion: sanitizeOptionalString(source.dismissedVersion),
    dismissedAt: sanitizeTimestamp(source.dismissedAt),
    cache: sanitizeUpdateCache(source.cache)
  }
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const DEFAULT_OLLAMA_MODEL = 'llama3.1'
const DEFAULT_OPENAI_COMPATIBLE_URL = 'http://127.0.0.1:1234/v1'
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'local-model'

function sanitizeAISettings(value: unknown): AIStoredSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<AIStoredSettings>
  const provider =
    source.provider === 'ollama' || source.provider === 'openai-compatible'
      ? source.provider
      : 'ollama'
  const baseUrl = sanitizeOptionalString(source.baseUrl) ??
    (provider === 'ollama' ? DEFAULT_OLLAMA_URL : DEFAULT_OPENAI_COMPATIBLE_URL)
  const model = sanitizeOptionalString(source.model) ??
    (provider === 'ollama' ? DEFAULT_OLLAMA_MODEL : DEFAULT_OPENAI_COMPATIBLE_MODEL)
  return { provider, baseUrl, model }
}

export function sanitizeSettings(settings: unknown): AppSettings {
  if (!settings || typeof settings !== 'object') return getDefaultSettings()
  const source = settings as Partial<AppSettings>
  const result: AppSettings = {
    queryLimit: sanitizeQueryLimit(source.queryLimit),
    updates: sanitizeUpdateSettings(source.updates)
  }
  const ai = sanitizeAISettings(source.ai)
  if (ai) result.ai = ai
  const language = sanitizeOptionalString(source.language)
  if (language) result.language = language
  return result
}

export function saveSettings(settings: AppSettings): void {
  try {
    const p = getSettingsPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const payload = {
      version: 1,
      ...sanitizeSettings(settings)
    }
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}
