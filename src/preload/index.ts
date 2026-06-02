import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import type { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo } from '../main/db/types'
import type { DatabaseSchema } from '../renderer/src/types/schema'

export type { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo }

export interface SavedQueryRecord {
  id: string
  name: string
  sql: string
  createdAt: number
  category?: string
}

export interface ConnectionLogEntry {
  id: string
  connectionId: string
  connectionName: string
  /** 'connected' | 'disconnected' | 'failed' */
  event: string
  timestamp: number
  error?: string
}

export interface PersistedQueryHistoryEntry {
  id: string
  sql: string
  connectionId: string | null
  connectionName: string
  timestamp: number
  duration: number
  rowCount: number
  error?: string
}

export interface SchemaCacheEntry {
  connectionId: string
  databaseName: string
  schemaJson: string
  cachedAt: number
}

export interface MetricDataPoint {
  timestamp: number
  value: number
}

export interface MetricDataResult {
  metricId: string
  data: MetricDataPoint[]
}

export interface DashboardWidget {
  /** react-grid-layout key — same as the widget's unique id */
  i: string
  metricId: string
  title: string
  x: number
  y: number
  w: number
  h: number
}

export interface DashboardLayoutRecord {
  id: string
  name: string
  /** JSON-serialised DashboardWidget[] */
  widgetsJson: string
  updatedAt: number
}

export type AITaskType = 'generate' | 'explain' | 'optimize'

export interface AIRequest {
  task: AITaskType
  prompt?: string
  sql?: string
  dbType?: string
}

export interface AIResponse {
  success: boolean
  output?: string
  error?: string
}

export type AIProvider = 'ollama' | 'openai-compatible'

export interface AISettings {
  provider: AIProvider
  baseUrl: string
  model: string
  localOnly: true
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

const dbAPI = {
  getConnections: (): Promise<ConnectionConfig[]> => ipcRenderer.invoke('db:get-connections'),
  saveConnection: (config: ConnectionConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('db:save-connection', config),
  deleteConnection: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('db:delete-connection', id),
  testConnection: (config: ConnectionConfig): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('db:test-connection', config),
  connect: (config: ConnectionConfig): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('db:connect', config),
  disconnect: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('db:disconnect', id),
  isConnected: (id: string): Promise<boolean> => ipcRenderer.invoke('db:is-connected', id),
  query: (connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult> =>
    ipcRenderer.invoke('db:query', connectionId, sql, params),
  getDatabases: (connectionId: string): Promise<string[]> =>
    ipcRenderer.invoke('db:get-databases', connectionId),
  getTables: (connectionId: string, database?: string): Promise<TableInfo[]> =>
    ipcRenderer.invoke('db:get-tables', connectionId, database),
  getColumns: (connectionId: string, table: string, database?: string): Promise<ColumnInfo[]> =>
    ipcRenderer.invoke('db:get-columns', connectionId, table, database),
  getSchema: (connectionId: string, database?: string): Promise<DatabaseSchema> =>
    ipcRenderer.invoke('db:get-schema', connectionId, database),
  getProcedures: (connectionId: string, database?: string): Promise<ProcedureInfo[]> =>
    ipcRenderer.invoke('db:get-procedures', connectionId, database),
  exportConnections: (includePasswords = false): Promise<{
    success: boolean
    canceled?: boolean
    path?: string
    count?: number
    error?: string
  }> =>
    ipcRenderer.invoke('db:export-connections', includePasswords),
  importConnections: (): Promise<{
    success: boolean
    canceled?: boolean
    imported?: number
    replaced?: number
    skippedDuplicates?: number
    skippedInvalid?: number
    error?: string
  }> => ipcRenderer.invoke('db:import-connections'),
  getSavedQueries: (): Promise<SavedQueryRecord[]> => ipcRenderer.invoke('queries:get'),
  saveQuery: (query: SavedQueryRecord): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('queries:save', query),
  deleteQuery: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('queries:delete', id),
  getAISettings: (): Promise<AISettings> =>
    ipcRenderer.invoke('ai:get-settings'),
  runAITask: (request: AIRequest): Promise<AIResponse> => ipcRenderer.invoke('ai:run-task', request),
  listAIModels: (request?: {
    provider?: 'ollama' | 'openai-compatible'
    baseUrl?: string
  }): Promise<{ success: boolean; models: string[]; error?: string }> =>
    ipcRenderer.invoke('ai:list-models', request),
  getLogPath: (): Promise<string> => ipcRenderer.invoke('app:get-log-path'),
  openLogs: (): Promise<{ success: boolean; path: string }> => ipcRenderer.invoke('app:open-logs'),
  getServerVersion: (connectionId: string): Promise<{ version: string }> =>
    ipcRenderer.invoke('db:get-server-version', connectionId),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:save', settings),
  getUpdateStatus: (): Promise<UpdateStatus | null> => ipcRenderer.invoke('updates:get-status'),
  checkForUpdatesNow: (): Promise<UpdateStatus | null> => ipcRenderer.invoke('updates:check-now'),
  ignoreUpdateVersion: (version?: string): Promise<UpdateStatus | null> =>
    ipcRenderer.invoke('updates:ignore-version', version),
  dismissUpdateVersion: (version?: string): Promise<UpdateStatus | null> =>
    ipcRenderer.invoke('updates:dismiss-version', version),
  openUpdateRelease: (url?: string): Promise<{ success: boolean; url: string }> =>
    ipcRenderer.invoke('updates:open-release', url),
  downloadUpdate: (): Promise<UpdateStatus | null> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('updates:install'),
  onConnectionLost: (callback: (connectionId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, connectionId: string): void => callback(connectionId)
    ipcRenderer.on('db:connection-lost', handler)
    return () => ipcRenderer.off('db:connection-lost', handler)
  },

  // Connection logs
  addConnectionLog: (entry: ConnectionLogEntry): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('logs:add-connection-log', entry),
  getConnectionLogs: (connectionId?: string, limit?: number): Promise<ConnectionLogEntry[]> =>
    ipcRenderer.invoke('logs:get-connection-logs', connectionId, limit),
  clearConnectionLogs: (connectionId?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('logs:clear-connection-logs', connectionId),

  // Persistent query history
  addToPersistedHistory: (entry: PersistedQueryHistoryEntry): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('history:add', entry),
  getPersistedHistory: (limit?: number): Promise<PersistedQueryHistoryEntry[]> =>
    ipcRenderer.invoke('history:get', limit),
  clearPersistedHistory: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('history:clear'),

  // Schema cache
  setSchemaCache: (connectionId: string, databaseName: string, schemaJson: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('schema-cache:set', connectionId, databaseName, schemaJson),
  getSchemaCache: (connectionId: string, databaseName: string): Promise<SchemaCacheEntry | null> =>
    ipcRenderer.invoke('schema-cache:get', connectionId, databaseName),
  clearSchemaCache: (connectionId?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('schema-cache:clear', connectionId),

  // Metric data
  getMetricData: (metricId: string, params?: { points?: number }): Promise<MetricDataResult> =>
    ipcRenderer.invoke('metrics:get-data', metricId, params),

  // Dashboard layouts
  getDashboardLayouts: (): Promise<DashboardLayoutRecord[]> =>
    ipcRenderer.invoke('dashboard:get-layouts'),
  saveDashboardLayout: (layout: DashboardLayoutRecord): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('dashboard:save-layout', layout),
  deleteDashboardLayout: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('dashboard:delete-layout', id)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('db', dbAPI)
} else {
  // @ts-ignore (for non-sandboxed environments)
  window.electron = electronAPI
  // @ts-ignore
  window.db = dbAPI
}
