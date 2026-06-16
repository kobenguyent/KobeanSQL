import { create } from 'zustand'
import type {
  ConnectionConfig,
  QueryTab,
  QueryResult,
  TableInfo,
  ColumnInfo,
  ProcedureInfo,
  DatabaseType,
  SavedQuery,
  QueryHistoryEntry,
  AppSettings,
  UpdateStatus,
  ForeignKeyInfo
} from '../types'
import type { DatabaseSchema } from '@renderer/types/schema'
import { buildProcedureCallSql, buildSelectTableSql, quoteIdentifier } from '../sql/dsl'
import { setLocale } from '../i18n'

const THEME_STORAGE_KEY = 'kobeansql-theme'
const UPDATE_DOWNLOAD_POLL_MS = 250

function loadPersistedTheme(): 'dark' | 'light' | 'system' | 'matrix' | 'cyberpunk' {
  try {
    if (typeof localStorage === 'undefined') return 'dark'
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system' || stored === 'matrix' || stored === 'cyberpunk') return stored
  } catch {/* ignore */}
  return 'dark'
}

const MAX_QUERY_HISTORY = 200

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeHistoryEntry(entry: unknown, index: number): QueryHistoryEntry {
  const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
  const now = Date.now()
  const fallbackId = `history-${now}-${index}`
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id : fallbackId,
    sql: typeof record.sql === 'string' ? record.sql : String(record.sql ?? ''),
    connectionId: record.connectionId == null ? null : String(record.connectionId),
    connectionName: typeof record.connectionName === 'string' && record.connectionName.trim()
      ? record.connectionName
      : 'Unknown connection',
    timestamp: asFiniteNumber(record.timestamp, now),
    duration: asFiniteNumber(record.duration, 0),
    rowCount: asFiniteNumber(record.rowCount, 0),
    error: typeof record.error === 'string' && record.error ? record.error : undefined
  }
}

// Use window.db API (injected by preload)
declare global {
  interface Window {
    db: {
      getConnections(): Promise<ConnectionConfig[]>
      saveConnection(config: ConnectionConfig): Promise<{ success: boolean }>
      deleteConnection(id: string): Promise<{ success: boolean }>
      testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string; detectedType?: DatabaseType }>
      connect(config: ConnectionConfig): Promise<{ success: boolean; error?: string; detectedType?: DatabaseType }>
      disconnect(id: string): Promise<{ success: boolean }>
      isConnected(id: string): Promise<boolean>
      query(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult>
      deleteRow(tableName: string, primaryKeyObject: Record<string, unknown>): Promise<boolean>
      insertRow(tableName: string, rowData: Record<string, unknown>): Promise<boolean>
      duplicateRow(tableName: string, primaryKeyObject: Record<string, unknown>): Promise<boolean>
      getDatabases(connectionId: string): Promise<string[]>
      getTables(connectionId: string, database?: string): Promise<TableInfo[]>
      getColumns(connectionId: string, table: string, database?: string): Promise<ColumnInfo[]>
      getForeignKeys(connectionId: string, table: string, database?: string): Promise<ForeignKeyInfo[]>
      getSchema(connectionId: string, database?: string): Promise<DatabaseSchema>
      getProcedures(connectionId: string, database?: string): Promise<ProcedureInfo[]>
      exportConnections(includePasswords?: boolean): Promise<{
        success: boolean
        canceled?: boolean
        path?: string
        count?: number
        error?: string
      }>
      importConnections(): Promise<{
        success: boolean
        canceled?: boolean
        imported?: number
        replaced?: number
        skippedDuplicates?: number
        skippedInvalid?: number
        error?: string
      }>
      getSavedQueries(): Promise<SavedQuery[]>
      saveQuery(query: SavedQuery): Promise<{ success: boolean }>
      deleteQuery(id: string): Promise<{ success: boolean }>
      getAISettings(): Promise<{
        provider: 'ollama' | 'openai-compatible'
        baseUrl: string
        model: string
        localOnly: true
      }>
      runAITask(request: {
        task: 'generate' | 'explain' | 'optimize'
        prompt?: string
        sql?: string
        dbType?: string
        schemaContext?: string
      }): Promise<{ success: boolean; output?: string; error?: string }>
      listAIModels(request?: {
        provider?: 'ollama' | 'openai-compatible'
        baseUrl?: string
      }): Promise<{ success: boolean; models: string[]; error?: string }>
      getLogPath(): Promise<string>
      openLogs(): Promise<{ success: boolean; path: string }>
      getServerVersion(connectionId: string): Promise<{ version: string }>
      getSettings(): Promise<AppSettings>
      saveSettings(settings: AppSettings): Promise<{ success: boolean }>
      getUpdateStatus(): Promise<UpdateStatus | null>
      checkForUpdatesNow(): Promise<UpdateStatus | null>
      ignoreUpdateVersion(version?: string): Promise<UpdateStatus | null>
      dismissUpdateVersion(version?: string): Promise<UpdateStatus | null>
      openUpdateRelease(url?: string): Promise<{ success: boolean; url: string }>
      downloadUpdate(): Promise<UpdateStatus | null>
      installUpdate(): Promise<{ success: boolean; error?: string }>
      onConnectionLost(callback: (connectionId: string) => void): () => void

      // Connection logs
      addConnectionLog(entry: {
        id: string; connectionId: string; connectionName: string
        event: string; timestamp: number; error?: string
      }): Promise<{ success: boolean }>
      getConnectionLogs(connectionId?: string, limit?: number): Promise<Array<{
        id: string; connectionId: string; connectionName: string
        event: string; timestamp: number; error?: string
      }>>
      clearConnectionLogs(connectionId?: string): Promise<{ success: boolean }>

      // Persistent query history
      addToPersistedHistory(entry: QueryHistoryEntry): Promise<{ success: boolean }>
      getPersistedHistory(limit?: number): Promise<QueryHistoryEntry[]>
      clearPersistedHistory(): Promise<{ success: boolean }>

      // Schema cache
      setSchemaCache(connectionId: string, databaseName: string, schemaJson: string): Promise<{ success: boolean }>
      getSchemaCache(connectionId: string, databaseName: string): Promise<{
        connectionId: string; databaseName: string; schemaJson: string; cachedAt: number
      } | null>
      clearSchemaCache(connectionId?: string): Promise<{ success: boolean }>

      // Metric data
      getMetricData(metricId: string, params?: { points?: number }): Promise<{
        metricId: string
        data: Array<{ timestamp: number; value: number }>
      }>

      // Dashboard layouts
      getDashboardLayouts(): Promise<Array<{
        id: string; name: string; widgetsJson: string; updatedAt: number
      }>>
      saveDashboardLayout(layout: {
        id: string; name: string; widgetsJson: string; updatedAt: number
      }): Promise<{ success: boolean }>
      deleteDashboardLayout(id: string): Promise<{ success: boolean }>
    }
  }
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function getNextNewQueryTitle(tabs: QueryTab[]): string {
  const re = /^New Query (\d+)$/
  let max = 0
  for (const tab of tabs) {
    const m = re.exec(tab.title)
    if (!m) continue
    const n = Number.parseInt(m[1], 10)
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return `New Query ${max + 1}`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface SchemaNode {
  databases: string[]
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnInfo[]>
  procedures: Record<string, ProcedureInfo[]>
  loadingDatabases: boolean
  loadingTables: Record<string, boolean>
  loadingProcedures: Record<string, boolean>
}

interface AppState {
  // Connections
  connections: ConnectionConfig[]
  connectedIds: Set<string>
  schema: Record<string, SchemaNode>
  connectionVersions: Record<string, string>

  // Tabs
  tabs: QueryTab[]
  activeTabId: string | null

  // Saved queries
  savedQueries: SavedQuery[]

  // Query history (in-memory)
  queryHistory: QueryHistoryEntry[]

  // Settings
  settings: AppSettings
  updateStatus: UpdateStatus | null

  // UI state
  sidebarWidth: number
  isSidebarCollapsed: boolean
  theme: 'dark' | 'light' | 'system' | 'matrix' | 'cyberpunk'
  statusMessage: string | null
  statusType: 'info' | 'success' | 'error' | 'warning'

  // Actions
  loadConnections(): Promise<void>
  saveConnection(config: ConnectionConfig): Promise<void>
  deleteConnection(id: string): Promise<void>
  connect(config: ConnectionConfig): Promise<{ success: boolean; error?: string }>
  disconnect(id: string): Promise<void>
  handleConnectionLost(id: string): void
  loadDatabases(connectionId: string): Promise<void>
  loadTables(connectionId: string, database: string): Promise<void>
  loadColumns(connectionId: string, table: string, database?: string): Promise<void>
  loadProcedures(connectionId: string, database: string): Promise<void>

  // Tab actions
  newTab(connectionId?: string | null): string
  closeTab(tabId: string): void
  setActiveTab(tabId: string): void
  moveTab(tabId: string, toIndex: number): void
  moveTabBlock(tabIds: string[], toIndex: number): void
  setTabColor(tabId: string, color: string | null): void
  setTabGroup(tabId: string, title: string | null, color?: string | null): void
  updateTabSql(tabId: string, sql: string): void
  updateTabConnection(tabId: string, connectionId: string): void
  runQuery(tabId: string, overrideSql?: string): Promise<void>
  insertSnippet(tabId: string, snippet: string): void
  openTableInTab(connectionId: string, tableName: string, database: string, schema?: string, filter?: { column: string; value: unknown }): Promise<void>
  openProcedureInTab(connectionId: string, proc: ProcedureInfo): void

  // Saved query actions
  loadSavedQueries(): Promise<void>
  saveCurrentQuery(tabId: string, name: string, category?: string): Promise<void>
  deleteSavedQuery(id: string): Promise<void>
  openSavedQuery(query: SavedQuery): void
  updateSavedQuery(query: SavedQuery): Promise<void>
  importConnections(): Promise<void>
  exportConnections(includePasswords?: boolean): Promise<void>
  openLogs(): Promise<void>

  // History actions
  loadHistory(): Promise<void>
  addToHistory(entry: QueryHistoryEntry): void
  clearHistory(): Promise<void>
  openHistoryEntry(entry: QueryHistoryEntry): void

  // Settings actions
  loadSettings(): Promise<void>
  updateSettings(s: Partial<AppSettings>): Promise<void>
  loadUpdateStatus(): Promise<void>
  checkForUpdatesNow(): Promise<void>
  ignoreUpdateVersion(version?: string): Promise<void>
  dismissUpdateVersion(version?: string): Promise<void>
  openUpdateRelease(url?: string): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>

  // UI actions
  setSidebarWidth(w: number): void
  setSidebarCollapsed(v: boolean): void
  setTheme(t: 'dark' | 'light' | 'system' | 'matrix' | 'cyberpunk'): void
  setStatus(msg: string | null, type?: AppState['statusType']): void
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  connectedIds: new Set(),
  schema: {},
  connectionVersions: {},
  tabs: [],
  activeTabId: null,
  savedQueries: [],
  queryHistory: [],
  settings: {
    queryLimit: 100,
    updates: { autoCheckEnabled: true, checkIntervalHours: 24, cache: {} }
  },
  updateStatus: null,
  sidebarWidth: 280,
  isSidebarCollapsed: false,
  theme: loadPersistedTheme(),
  statusMessage: null,
  statusType: 'info',

  loadConnections: async () => {
    const connections = await window.db.getConnections()
    set({ connections })
  },

  saveConnection: async (config) => {
    await window.db.saveConnection(config)
    await get().loadConnections()
  },

  deleteConnection: async (id) => {
    await window.db.deleteConnection(id)
    const { connectedIds, schema } = get()
    const nextIds = new Set(connectedIds)
    nextIds.delete(id)
    const nextSchema = { ...schema }
    delete nextSchema[id]
    set({ connectedIds: nextIds, schema: nextSchema })
    await get().loadConnections()
  },

  connect: async (config) => {
    const result = await window.db.connect(config)
    if (result.success) {
      const { connectedIds, schema, connections } = get()
      const nextIds = new Set(connectedIds).add(config.id)
      const nextConnections = result.detectedType && result.detectedType !== config.type
        ? connections.map(c => c.id === config.id ? { ...c, type: result.detectedType! } : c)
        : connections
      const nextSchema = { ...schema }
      if (!nextSchema[config.id]) {
        nextSchema[config.id] = {
          databases: [], tables: {}, columns: {}, procedures: {},
          loadingDatabases: false, loadingTables: {}, loadingProcedures: {}
        }
      }
      set({ connectedIds: nextIds, connections: nextConnections, schema: nextSchema })
      
      const finalType = result.detectedType || config.type
      const typeLabel = finalType === 'mariadb' ? 'MariaDB' : finalType.charAt(0).toUpperCase() + finalType.slice(1)
      get().setStatus(`Connected to ${config.name} (${typeLabel})`, 'success')
      
      void window.db.addConnectionLog({ id: genId(), connectionId: config.id, connectionName: config.name, event: 'connected', timestamp: Date.now() }).catch(() => {})
      await get().loadDatabases(config.id)
      
      window.db.getServerVersion(config.id).then(({ version }) => {
        if (get().connectedIds.has(config.id)) {
          set(s => ({ connectionVersions: { ...s.connectionVersions, [config.id]: version } }))
        }
      }).catch(() => {})
    } else {
      void window.db.addConnectionLog({ id: genId(), connectionId: config.id, connectionName: config.name, event: 'failed', timestamp: Date.now(), error: result.error }).catch(() => {})
    }
    return result
  },

  disconnect: async (id) => {
    await window.db.disconnect(id)
    const { connectedIds, schema, connectionVersions, connections } = get()
    const nextIds = new Set(connectedIds)
    nextIds.delete(id)
    const nextSchema = { ...schema }; delete nextSchema[id]
    const nextVersions = { ...connectionVersions }; delete nextVersions[id]
    set({ connectedIds: nextIds, schema: nextSchema, connectionVersions: nextVersions })
    const conn = connections.find(c => c.id === id)
    get().setStatus(`Disconnected from ${conn?.name}`, 'info')
    void window.db.addConnectionLog({ id: genId(), connectionId: id, connectionName: conn?.name ?? id, event: 'disconnected', timestamp: Date.now() }).catch(() => {})
  },

  handleConnectionLost: (id) => {
    const { connectedIds, schema, connectionVersions, connections } = get()
    const nextIds = new Set(connectedIds)
    nextIds.delete(id)
    const nextSchema = { ...schema }; delete nextSchema[id]
    const nextVersions = { ...connectionVersions }; delete nextVersions[id]
    set({ connectedIds: nextIds, schema: nextSchema, connectionVersions: nextVersions })
    const conn = connections.find(c => c.id === id)
    get().setStatus(`Connection to ${conn?.name ?? id} was lost`, 'error')
    void window.db.addConnectionLog({ id: genId(), connectionId: id, connectionName: conn?.name ?? id, event: 'disconnected', timestamp: Date.now(), error: 'Connection lost' }).catch(() => {})
  },

  loadDatabases: async (connectionId) => {
    const { schema } = get()
    if (!schema[connectionId]) return
    set({ schema: { ...schema, [connectionId]: { ...schema[connectionId], loadingDatabases: true } } })
    try {
      const databases = await window.db.getDatabases(connectionId)
      set(s => ({ schema: { ...s.schema, [connectionId]: { ...s.schema[connectionId], databases, loadingDatabases: false } } }))
    } catch {
      set(s => ({ schema: { ...s.schema, [connectionId]: { ...s.schema[connectionId], loadingDatabases: false } } }))
    }
  },

  loadTables: async (connectionId, database) => {
    const { schema } = get()
    if (!schema[connectionId]) return
    set({ schema: { ...schema, [connectionId]: { ...schema[connectionId], loadingTables: { ...schema[connectionId].loadingTables, [database]: true } } } })
    try {
      const tables = await window.db.getTables(connectionId, database)
      set(s => ({ schema: { ...s.schema, [connectionId]: { ...s.schema[connectionId], tables: { ...s.schema[connectionId].tables, [database]: tables }, loadingTables: { ...s.schema[connectionId].loadingTables, [database]: false } } } }))
      for (const table of tables) {
        void get().loadColumns(connectionId, table.schema ? `${table.schema}.${table.name}` : table.name, database)
      }
    } catch {
      set(s => ({ schema: { ...s.schema, [connectionId]: { ...s.schema[connectionId], loadingTables: { ...s.schema[connectionId].loadingTables, [database]: false } } } }))
    }
  },

  loadColumns: async (connectionId, table, database) => {
    const key = database ? `${database}.${table}` : table
    try {
      const columns = await window.db.getColumns(connectionId, table, database)
      set(s => (s.schema[connectionId] ? { schema: { ...s.schema, [connectionId]: { ...s.schema[connectionId], columns: { ...s.schema[connectionId].columns, [key]: columns } } } } : {}))
    } catch {}
  },

  loadProcedures: async (connectionId, database) => {
    const { schema } = get()
    if (!schema[connectionId]) return
    set({ schema: { ...schema, [connectionId]: { ...schema[connectionId], loadingProcedures: { ...schema[connectionId].loadingProcedures, [database]: true } } } })
    try {
      const procedures = await window.db.getProcedures(connectionId, database)
      set(s => ({ schema: { ...s.schema, [connectionId]: { ...s.schema[connectionId], procedures: { ...s.schema[connectionId].procedures, [database]: procedures }, loadingProcedures: { ...s.schema[connectionId].loadingProcedures, [database]: false } } } }))
    } catch {
      set(s => ({ schema: { ...s.schema, [connectionId]: { ...s.schema[connectionId], loadingProcedures: { ...s.schema[connectionId].loadingProcedures, [database]: false } } } }))
    }
  },

  newTab: (connectionId = null) => {
    const id = genId(), { tabs } = get()
    const tab: QueryTab = { id, title: getNextNewQueryTitle(tabs), tabType: 'query', connectionId: connectionId || tabs[tabs.length - 1]?.connectionId || null, sql: '', result: null, isRunning: false, isSaved: false, lastSavedSql: '' }
    set({ tabs: [...tabs, tab], activeTabId: id })
    return id
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex(t => t.id === tabId)
    if (idx < 0) return
    const nextTabs = tabs.filter(t => t.id !== tabId)
    set({ tabs: nextTabs, activeTabId: nextTabs.length === 0 ? null : (activeTabId === tabId ? nextTabs[Math.min(idx, nextTabs.length - 1)].id : activeTabId) })
  },

  setActiveTab: (activeTabId) => set({ activeTabId }),

  moveTab: (tabId, toIndex) => {
    const { tabs } = get(), fromIndex = tabs.findIndex(t => t.id === tabId)
    if (fromIndex < 0) return
    const nextTabs = [...tabs], [tab] = nextTabs.splice(fromIndex, 1)
    nextTabs.splice(Math.max(0, Math.min(toIndex, nextTabs.length)), 0, tab)
    set({ tabs: nextTabs })
  },

  moveTabBlock: (tabIds, toIndex) => {
    const { tabs } = get(), ids = new Set(tabIds)
    const block = tabs.filter(t => ids.has(t.id))
    if (block.length === 0) return
    const nextTabs = tabs.filter(t => !ids.has(t.id))
    nextTabs.splice(Math.max(0, Math.min(toIndex, nextTabs.length)), 0, ...block)
    set({ tabs: nextTabs })
  },

  setTabColor: (tabId, color) => set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, tabColor: color || undefined } : t) })),

  setTabGroup: (tabId, title, color) => set(s => ({
    tabs: s.tabs.map(t => {
      if (t.id !== tabId) return t
      const nextTitle = title?.trim() ?? ''
      return { ...t, groupTitle: nextTitle || undefined, groupColor: (nextTitle && color !== undefined) ? (color || undefined) : (nextTitle ? t.groupColor : undefined) }
    })
  })),

  updateTabSql: (tabId, sql) => set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, sql } : t) })),

  updateTabConnection: (tabId, connectionId) => set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, connectionId } : t) })),

  runQuery: async (tabId, overrideSql) => {
    const { tabs, connectedIds } = get(), tab = tabs.find(t => t.id === tabId)
    if (!tab?.connectionId) return get().setStatus('No connection', 'warning')
    if (!connectedIds.has(tab.connectionId)) return get().setStatus('Not connected', 'error')
    
    const sqlToRun = overrideSql || tab.sql
    if (!sqlToRun.trim()) return

    set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, isRunning: true } : t) }))
    try {
      const result = await window.db.query(tab.connectionId, sqlToRun)
      set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, result, isRunning: false } : t) }))
      const conn = get().connections.find(c => c.id === tab.connectionId)
      get().addToHistory({ id: genId(), sql: sqlToRun, connectionId: tab.connectionId, connectionName: conn?.name ?? 'Unknown', timestamp: Date.now(), duration: result.duration, rowCount: result.rowCount, error: result.error })
      result.error ? get().setStatus(result.error, 'error') : get().setStatus(`${result.rowCount} rows in ${result.duration}ms`, 'success')
    } catch (err) {
      set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, isRunning: false } : t) }))
      get().setStatus((err as Error).message, 'error')
    }
  },

  insertSnippet: (tabId, snippet) => set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, sql: t.sql ? `${t.sql}\n${snippet}` : snippet } : t) })),

  openTableInTab: async (connectionId, tableName, database, schema, filter) => {
    const dbType = get().connections.find(c => c.id === connectionId)?.type ?? 'postgres'
    const limit = get().settings.queryLimit || 100
    const sql = buildSelectTableSql(dbType, tableName, schema ?? database, limit, filter)
    const id = genId()
    set(s => ({ tabs: [...s.tabs, { id, title: filter ? `${tableName} (${filter.column}=${filter.value})` : tableName, tableName, tabType: 'table', connectionId, sql, result: null, isRunning: false, isSaved: false, database, schema }], activeTabId: id }))
    await get().runQuery(id, sql)
    },

  openProcedureInTab: (connectionId, proc) => {
    const dbType = get().connections.find(c => c.id === connectionId)?.type ?? 'postgres'
    const sql = buildProcedureCallSql(dbType, proc.name, proc.type, proc.schema)
    const id = genId()
    set(s => ({ tabs: [...s.tabs, { id, title: proc.name, tabType: 'procedure', connectionId, sql: `-- ${proc.type}: ${proc.name}\n${sql}`, result: null, isRunning: false, isSaved: false }], activeTabId: id }))
  },

  loadSavedQueries: async () => set({ savedQueries: await window.db.getSavedQueries() }),

  saveCurrentQuery: async (tabId, name, category) => {
    const tab = get().tabs.find(t => t.id === tabId)
    if (!tab?.sql.trim()) return
    const query = { id: genId(), name, sql: tab.sql, createdAt: Date.now(), ...(category ? { category } : {}) }
    await window.db.saveQuery(query)
    await get().loadSavedQueries()
    set(s => ({ tabs: s.tabs.map(t => t.id === tabId ? { ...t, title: name, isSaved: true, lastSavedSql: t.sql } : t) }))
    get().setStatus(`Saved: ${name}`, 'success')
  },

  deleteSavedQuery: async (id) => {
    await window.db.deleteQuery(id)
    set(s => ({ savedQueries: s.savedQueries.filter(q => q.id !== id) }))
  },

  updateSavedQuery: async (query) => {
    await window.db.saveQuery(query)
    set(s => ({ savedQueries: s.savedQueries.map(q => q.id === query.id ? query : q) }))
  },

  importConnections: async () => {
    const res = await window.db.importConnections()
    if (!res.canceled && res.success) await get().loadConnections()
  },

  exportConnections: async (pwd) => {
    const res = await window.db.exportConnections(pwd)
    if (!res.canceled && res.success) get().setStatus(`Exported ${res.count}`, 'success')
  },

  openLogs: async () => { if ((await window.db.openLogs()).success) get().setStatus('Opened logs', 'info') },

  openSavedQuery: (q) => {
    const { tabs, activeTabId } = get(), active = tabs.find(t => t.id === activeTabId)
    const existing = tabs.find(t => t.tabType === 'query' && t.title === q.name && t.lastSavedSql === q.sql)
    if (existing) return set({ activeTabId: existing.id })
    if (active?.tabType === 'query') {
      set(s => ({ tabs: s.tabs.map(t => t.id === active.id ? { ...t, title: q.name, sql: q.sql, result: null, isRunning: false, isSaved: true, lastSavedSql: q.sql } : t), activeTabId: active.id }))
    } else {
      const id = genId()
      set(s => ({ tabs: [...s.tabs, { id, title: q.name, tabType: 'query', connectionId: active?.connectionId || null, sql: q.sql, result: null, isRunning: false, isSaved: true, lastSavedSql: q.sql }], activeTabId: id }))
    }
  },

  loadHistory: async () => set({ queryHistory: (await window.db.getPersistedHistory(MAX_QUERY_HISTORY)).map(normalizeHistoryEntry) }),

  addToHistory: (entry) => {
    set(s => {
      const next = [entry, ...s.queryHistory]
      if (next.length > MAX_QUERY_HISTORY) next.length = MAX_QUERY_HISTORY
      return { queryHistory: next }
    })
    void window.db.addToPersistedHistory(entry).catch(() => {})
  },

  clearHistory: async () => {
    set({ queryHistory: [] })
    await window.db.clearPersistedHistory().catch(() => {})
  },

  openHistoryEntry: (e) => {
    const id = genId(), { tabs, activeTabId } = get()
    set(s => ({ tabs: [...s.tabs, { id, title: 'History Query', tabType: 'query', connectionId: e.connectionId ?? tabs.find(t => t.id === activeTabId)?.connectionId ?? null, sql: e.sql, result: null, isRunning: false, isSaved: false, lastSavedSql: e.sql }], activeTabId: id }))
  },

  loadSettings: async () => {
    const s = await window.db.getSettings()
    set({ settings: s })
    if (s.language) setLocale(s.language)
    await get().loadUpdateStatus()
  },

  updateSettings: async (p) => {
    const next = { ...get().settings, ...p, updates: { ...get().settings.updates, ...(p.updates || {}) } }
    set({ settings: next })
    await window.db.saveSettings(next)
    await get().loadUpdateStatus()
  },

  loadUpdateStatus: async () => set({ updateStatus: await window.db.getUpdateStatus() }),

  checkForUpdatesNow: async () => {
    const s = await window.db.checkForUpdatesNow()
    if (s) set({ updateStatus: s })
  },

  ignoreUpdateVersion: async (v) => {
    const s = await window.db.ignoreUpdateVersion(v)
    if (s) set({ updateStatus: s })
  },

  dismissUpdateVersion: async (v) => {
    const s = await window.db.dismissUpdateVersion(v)
    if (s) set({ updateStatus: s })
  },

  openUpdateRelease: async (u) => { await window.db.openUpdateRelease(u) },

  downloadUpdate: async () => {
    set(s => ({ updateStatus: s.updateStatus ? { ...s.updateStatus, downloadState: 'downloading', downloadProgress: 0 } : null }))
    const s = await window.db.downloadUpdate()
    if (s) set({ updateStatus: s })
  },

  installUpdate: async () => { await window.db.installUpdate() },

  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
  setTheme: (theme) => {
    set({ theme })
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  },
  setStatus: (statusMessage, statusType = 'info') => {
    set({ statusMessage, statusType })
    if (statusMessage && (statusType === 'error' || statusType === 'success')) {
      setTimeout(() => set(s => s.statusMessage === statusMessage ? { statusMessage: null } : {}), 6000)
    }
  }
}))

// Register listener
if (typeof window !== 'undefined' && window.db?.onConnectionLost) {
  window.db.onConnectionLost((id: string) => useAppStore.getState().handleConnectionLost(id))
}
