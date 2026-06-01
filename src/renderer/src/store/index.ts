import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'
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
  UpdateStatus
} from '../types'
import type { DatabaseSchema } from '@renderer/types/schema'
import { buildProcedureCallSql, buildSelectTableSql, quoteIdentifier } from '../sql/dsl'
import { setLocale } from '../i18n'

const THEME_STORAGE_KEY = 'kobeansql-theme'
const UPDATE_DOWNLOAD_POLL_MS = 250

function loadPersistedTheme(): 'dark' | 'light' | 'system' | 'matrix' | 'cyberpunk' {
  try {
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

// Required for Immer to handle Set and Map mutations inside producers
enableMapSet()

// Use window.db API (injected by preload)
declare global {
  interface Window {
    db: {
      getConnections(): Promise<ConnectionConfig[]>
      saveConnection(config: ConnectionConfig): Promise<{ success: boolean }>
      deleteConnection(id: string): Promise<{ success: boolean }>
      testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }>
      connect(config: ConnectionConfig): Promise<{ success: boolean; error?: string }>
      disconnect(id: string): Promise<{ success: boolean }>
      isConnected(id: string): Promise<boolean>
      query(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult>
      getDatabases(connectionId: string): Promise<string[]>
      getTables(connectionId: string, database?: string): Promise<TableInfo[]>
      getColumns(connectionId: string, table: string, database?: string): Promise<ColumnInfo[]>
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
  runQuery(tabId: string): Promise<void>
  insertSnippet(tabId: string, snippet: string): void
  openTableInTab(connectionId: string, tableName: string, database: string, schema?: string): Promise<void>
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

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
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
      updates: {
        autoCheckEnabled: true,
        checkIntervalHours: 24,
        cache: {}
      }
    },
    updateStatus: null,
    sidebarWidth: 280,
    isSidebarCollapsed: false,
    theme: loadPersistedTheme(),
    statusMessage: null,
    statusType: 'info',
    loadConnections: async () => {
      const connections = await window.db.getConnections()
      set((s) => {
        s.connections = connections
      })
    },

    saveConnection: async (config) => {
      await window.db.saveConnection(config)
      await get().loadConnections()
    },

    deleteConnection: async (id) => {
      await window.db.deleteConnection(id)
      set((s) => {
        s.connectedIds.delete(id)
        delete s.schema[id]
      })
      await get().loadConnections()
    },

    connect: async (config) => {
      const result = await window.db.connect(config)
      if (result.success) {
        set((s) => {
          s.connectedIds.add(config.id)
          if (!s.schema[config.id]) {
            s.schema[config.id] = {
              databases: [],
              tables: {},
              columns: {},
              procedures: {},
              loadingDatabases: false,
              loadingTables: {},
              loadingProcedures: {}
            }
          }
        })
        get().setStatus(`Connected to ${config.name}`, 'success')
        void window.db.addConnectionLog({
          id: genId(),
          connectionId: config.id,
          connectionName: config.name,
          event: 'connected',
          timestamp: Date.now()
        }).catch(() => {/* ignore */})
        await get().loadDatabases(config.id)
        // Fetch server version in background
        window.db.getServerVersion(config.id).then(({ version }) => {
          set((s) => {
            if (s.connectedIds.has(config.id)) {
              s.connectionVersions[config.id] = version
            }
          })
        }).catch(() => {/* ignore */})
      } else {
        void window.db.addConnectionLog({
          id: genId(),
          connectionId: config.id,
          connectionName: config.name,
          event: 'failed',
          timestamp: Date.now(),
          error: result.error
        }).catch(() => {/* ignore */})
      }
      return result
    },

    disconnect: async (id) => {
      await window.db.disconnect(id)
      set((s) => {
        s.connectedIds.delete(id)
        delete s.schema[id]
        delete s.connectionVersions[id]
      })
      const conn = get().connections.find((c) => c.id === id)
      get().setStatus(`Disconnected from ${conn?.name}`, 'info')
      void window.db.addConnectionLog({
        id: genId(),
        connectionId: id,
        connectionName: conn?.name ?? id,
        event: 'disconnected',
        timestamp: Date.now()
      }).catch(() => {/* ignore */})
    },

    handleConnectionLost: (id) => {
      set((s) => {
        s.connectedIds.delete(id)
        delete s.schema[id]
        delete s.connectionVersions[id]
      })
      const conn = get().connections.find((c) => c.id === id)
      get().setStatus(`Connection to ${conn?.name ?? id} was lost`, 'error')
      void window.db.addConnectionLog({
        id: genId(),
        connectionId: id,
        connectionName: conn?.name ?? id,
        event: 'disconnected',
        timestamp: Date.now(),
        error: 'Connection lost unexpectedly'
      }).catch(() => {/* ignore */})
    },

    loadDatabases: async (connectionId) => {
      set((s) => {
        if (s.schema[connectionId]) {
          s.schema[connectionId].loadingDatabases = true
        }
      })
      try {
        const databases = await window.db.getDatabases(connectionId)
        set((s) => {
          if (s.schema[connectionId]) {
            s.schema[connectionId].databases = databases
            s.schema[connectionId].loadingDatabases = false
          }
        })
      } catch {
        set((s) => {
          if (s.schema[connectionId]) {
            s.schema[connectionId].loadingDatabases = false
          }
        })
      }
    },

    loadTables: async (connectionId, database) => {
      set((s) => {
        if (s.schema[connectionId]) {
          s.schema[connectionId].loadingTables[database] = true
        }
      })
      try {
        const tables = await window.db.getTables(connectionId, database)
        set((s) => {
          if (s.schema[connectionId]) {
            s.schema[connectionId].tables[database] = tables
            s.schema[connectionId].loadingTables[database] = false
          }
        })
        // Eagerly load columns for all tables in the background so that SQL
        // autocomplete has field names available without the user needing to
        // expand each table in the sidebar first.
        for (const table of tables) {
          const qualifiedTableName = table.schema ? `${table.schema}.${table.name}` : table.name
          void get().loadColumns(connectionId, qualifiedTableName, database)
        }
      } catch {
        set((s) => {
          if (s.schema[connectionId]) {
            s.schema[connectionId].loadingTables[database] = false
          }
        })
      }
    },

    loadColumns: async (connectionId, table, database) => {
      const key = database ? `${database}.${table}` : table
      try {
        const columns = await window.db.getColumns(connectionId, table, database)
        set((s) => {
          if (s.schema[connectionId]) {
            s.schema[connectionId].columns[key] = columns
          }
        })
      } catch {}
    },

    loadProcedures: async (connectionId, database) => {
      set((s) => {
        if (s.schema[connectionId]) {
          s.schema[connectionId].loadingProcedures[database] = true
        }
      })
      try {
        const procedures = await window.db.getProcedures(connectionId, database)
        set((s) => {
          if (s.schema[connectionId]) {
            s.schema[connectionId].procedures[database] = procedures
            s.schema[connectionId].loadingProcedures[database] = false
          }
        })
      } catch {
        set((s) => {
          if (s.schema[connectionId]) {
            s.schema[connectionId].loadingProcedures[database] = false
          }
        })
      }
    },

    newTab: (connectionId = null) => {
      const id = genId()
      const tabs = get().tabs
      const tab: QueryTab = {
        id,
        title: getNextNewQueryTitle(tabs),
        tabType: 'query',
        connectionId: connectionId || tabs[tabs.length - 1]?.connectionId || null,
        sql: '',
        result: null,
        isRunning: false,
        isSaved: false,
        lastSavedSql: ''
      }
      set((s) => {
        s.tabs.push(tab)
        s.activeTabId = id
      })
      return id
    },

    closeTab: (tabId) => {
      const { tabs, activeTabId } = get()
      const idx = tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return
      set((s) => {
        s.tabs.splice(idx, 1)
        if (s.tabs.length === 0) {
          s.activeTabId = null
        } else if (activeTabId === tabId) {
          s.activeTabId = s.tabs[Math.min(idx, s.tabs.length - 1)].id
        }
      })
    },

    setActiveTab: (tabId) => {
      set((s) => {
        s.activeTabId = tabId
      })
    },

    moveTab: (tabId, toIndex) => {
      set((s) => {
        const fromIndex = s.tabs.findIndex((t) => t.id === tabId)
        if (fromIndex < 0) return
        const [tab] = s.tabs.splice(fromIndex, 1)
        const bounded = Math.max(0, Math.min(toIndex, s.tabs.length))
        s.tabs.splice(bounded, 0, tab)
      })
    },

    moveTabBlock: (tabIds, toIndex) => {
      set((s) => {
        if (tabIds.length === 0) return
        const ids = new Set(tabIds)
        const block = s.tabs.filter((t) => ids.has(t.id))
        if (block.length === 0) return
        s.tabs = s.tabs.filter((t) => !ids.has(t.id))
        const bounded = Math.max(0, Math.min(toIndex, s.tabs.length))
        s.tabs.splice(bounded, 0, ...block)
      })
    },

    setTabColor: (tabId, color) => {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId)
        if (tab) tab.tabColor = color || undefined
      })
    },

    setTabGroup: (tabId, title, color) => {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId)
        if (!tab) return
        const nextTitle = title?.trim() ?? ''
        tab.groupTitle = nextTitle ? nextTitle : undefined
        if (color !== undefined) {
          tab.groupColor = color || undefined
        }
        if (!tab.groupTitle) {
          tab.groupColor = undefined
        }
      })
    },

    updateTabSql: (tabId, sql) => {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId)
        if (tab) tab.sql = sql
      })
    },

    updateTabConnection: (tabId, connectionId) => {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId)
        if (tab) tab.connectionId = connectionId
      })
    },

    runQuery: async (tabId) => {
      const { tabs, connectedIds } = get()
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab || !tab.connectionId) {
        get().setStatus('No database connection selected', 'warning')
        return
      }
      if (!connectedIds.has(tab.connectionId)) {
        get().setStatus('Not connected to database', 'error')
        return
      }
      set((s) => {
        const t = s.tabs.find((t) => t.id === tabId)
        if (t) t.isRunning = true
      })
      try {
        const result = await window.db.query(tab.connectionId, tab.sql)
        set((s) => {
          const t = s.tabs.find((t) => t.id === tabId)
          if (t) {
            t.result = result
            t.isRunning = false
          }
        })
        const conn = get().connections.find((c) => c.id === tab.connectionId)
        get().addToHistory({
          id: genId(),
          sql: tab.sql,
          connectionId: tab.connectionId,
          connectionName: conn?.name ?? 'Unknown',
          timestamp: Date.now(),
          duration: result.duration,
          rowCount: result.rowCount,
          error: result.error
        })
        if (result.error) {
          get().setStatus(result.error, 'error')
        } else {
          get().setStatus(
            `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} in ${result.duration}ms`,
            'success'
          )
        }
      } catch (err) {
        set((s) => {
          const t = s.tabs.find((t) => t.id === tabId)
          if (t) t.isRunning = false
        })
        const conn = get().connections.find((c) => c.id === tab.connectionId)
        get().addToHistory({
          id: genId(),
          sql: tab.sql,
          connectionId: tab.connectionId,
          connectionName: conn?.name ?? 'Unknown',
          timestamp: Date.now(),
          duration: 0,
          rowCount: 0,
          error: (err as Error).message
        })
        get().setStatus((err as Error).message, 'error')
      }
    },

    insertSnippet: (tabId, snippet) => {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.sql = tab.sql ? `${tab.sql}\n${snippet}` : snippet
        }
      })
    },

    openTableInTab: async (connectionId, tableName, database, schema) => {
      const conn = get().connections.find((c) => c.id === connectionId)
      const dbType: DatabaseType = conn?.type ?? 'postgres'
      const qualifier = schema ?? database
      const { settings } = get()
      const limit = settings.queryLimit || 100
      const sql = buildSelectTableSql(dbType, tableName, qualifier, limit)
      const id = genId()
      const tab: QueryTab = {
        id,
        title: tableName,
        tabType: 'table',
        connectionId,
        sql,
        result: null,
        isRunning: false,
        isSaved: false,
        database,
        schema
      }
      set((s) => {
        s.tabs.push(tab)
        s.activeTabId = id
      })
      await get().runQuery(id)
    },

    openProcedureInTab: (connectionId, proc) => {
      const conn = get().connections.find((c) => c.id === connectionId)
      const dbType: DatabaseType = conn?.type ?? 'postgres'
      const qualifiedName = proc.schema
        ? `${quoteIdentifier(proc.schema, dbType)}.${quoteIdentifier(proc.name, dbType)}`
        : quoteIdentifier(proc.name, dbType)
      const sql = buildProcedureCallSql(dbType, proc.name, proc.type, proc.schema)
      const sqlWithComment =
        proc.type === 'function'
          ? `-- Function: ${qualifiedName}\n${sql}`
          : `-- Procedure: ${qualifiedName}\n${sql}`

      const id = genId()
      const tab: QueryTab = {
        id,
        title: proc.name,
        tabType: 'procedure',
        connectionId,
        sql: sqlWithComment,
        result: null,
        isRunning: false,
        isSaved: false
      }
      set((s) => {
        s.tabs.push(tab)
        s.activeTabId = id
      })
    },
    loadSavedQueries: async () => {
      const queries = await window.db.getSavedQueries()
      set((s) => {
        s.savedQueries = queries
      })
    },

    saveCurrentQuery: async (tabId, name, category) => {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || !tab.sql.trim()) return
      const query: SavedQuery = {
        id: genId(),
        name,
        sql: tab.sql,
        createdAt: Date.now(),
        ...(category ? { category } : {})
      }
      await window.db.saveQuery(query)
      await get().loadSavedQueries()
      set((s) => {
        const t = s.tabs.find((x) => x.id === tabId)
        if (t) {
          t.title = name
          t.isSaved = true
          t.lastSavedSql = t.sql
        }
      })
      get().setStatus(`Query saved: ${name}`, 'success')
    },

    deleteSavedQuery: async (id) => {
      await window.db.deleteQuery(id)
      set((s) => {
        s.savedQueries = s.savedQueries.filter((q) => q.id !== id)
      })
    },

    updateSavedQuery: async (query) => {
      await window.db.saveQuery(query)
      set((s) => {
        const idx = s.savedQueries.findIndex((q) => q.id === query.id)
        if (idx >= 0) s.savedQueries[idx] = query
      })
    },

    importConnections: async () => {
      try {
        const result = await window.db.importConnections()
        if (result.canceled) return
        if (!result.success) {
          get().setStatus(`Failed to import connections${result.error ? `: ${result.error}` : ''}`, 'error')
          return
        }
        await get().loadConnections()
        get().setStatus(
          `Imported ${result.imported ?? 0}, replaced ${result.replaced ?? 0}, skipped ${result.skippedDuplicates ?? 0} duplicates`,
          'success'
        )
      } catch (error) {
        get().setStatus(`Failed to import connections: ${getErrorMessage(error)}`, 'error')
      }
    },

    exportConnections: async (includePasswords = false) => {
      if (get().connections.length === 0) {
        get().setStatus('No connections to export', 'warning')
        return
      }
      try {
        const result = await window.db.exportConnections(includePasswords)
        if (result.canceled) return
        if (!result.success) {
          get().setStatus(`Failed to export connections${result.error ? `: ${result.error}` : ''}`, 'error')
          return
        }
        get().setStatus(`Exported ${result.count ?? 0} connection(s)`, 'success')
      } catch (error) {
        get().setStatus(`Failed to export connections: ${getErrorMessage(error)}`, 'error')
      }
    },

    openLogs: async () => {
      try {
        const result = await window.db.openLogs()
        if (result.success) {
          get().setStatus('Opened logs folder', 'info')
        }
      } catch (error) {
        get().setStatus((error as Error).message, 'error')
      }
    },

    openSavedQuery: (query) => {
      const { tabs, activeTabId } = get()
      const activeTab = tabs.find((t) => t.id === activeTabId)

      const existingTab = tabs.find(
        (t) => t.tabType === 'query' && t.title === query.name && t.lastSavedSql === query.sql
      )
      if (existingTab) {
        set((s) => {
          s.activeTabId = existingTab.id
        })
        return
      }

      if (activeTab?.tabType === 'query') {
        set((s) => {
          const target = s.tabs.find((t) => t.id === activeTab.id)
          if (!target) return
          target.title = query.name
          target.sql = query.sql
          target.result = null
          target.isRunning = false
          target.isSaved = true
          target.lastSavedSql = query.sql
          s.activeTabId = target.id
        })
        return
      }

      const id = genId()
      const tab: QueryTab = {
        id,
        title: query.name,
        tabType: 'query',
        connectionId: activeTab?.connectionId || null,
        sql: query.sql,
        result: null,
        isRunning: false,
        isSaved: true,
        lastSavedSql: query.sql
      }
      set((s) => {
        s.tabs.push(tab)
        s.activeTabId = id
      })
    },

    loadHistory: async () => {
      try {
        const entries = await window.db.getPersistedHistory(MAX_QUERY_HISTORY)
        const normalized = entries.map((entry, index) => normalizeHistoryEntry(entry, index))
        set((s) => {
          s.queryHistory = normalized
        })
      } catch {/* ignore — degraded gracefully if local store is unavailable */}
    },

    addToHistory: (entry) => {
      set((s) => {
        s.queryHistory.unshift(entry)
        if (s.queryHistory.length > MAX_QUERY_HISTORY) {
          s.queryHistory.length = MAX_QUERY_HISTORY
        }
      })
      // Persist asynchronously — failure is non-fatal
      void window.db.addToPersistedHistory(entry).catch(() => {/* ignore */})
    },

    clearHistory: async () => {
      set((s) => {
        s.queryHistory = []
      })
      try {
        await window.db.clearPersistedHistory()
      } catch {/* ignore */}
    },

    openHistoryEntry: (entry) => {
      const id = genId()
      const { tabs, activeTabId } = get()
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const tab: QueryTab = {
        id,
        title: 'History Query',
        tabType: 'query',
        connectionId: entry.connectionId ?? activeTab?.connectionId ?? null,
        sql: entry.sql,
        result: null,
        isRunning: false,
        isSaved: false,
        lastSavedSql: entry.sql
      }
      set((s) => {
        s.tabs.push(tab)
        s.activeTabId = id
      })
    },

    loadSettings: async () => {
      try {
        const s = await window.db.getSettings()
        set((state) => {
          state.settings = s
        })
        if (s.language) {
          setLocale(s.language)
        }
        await get().loadUpdateStatus()
      } catch {/* ignore */}
    },

    updateSettings: async (partial) => {
      const merged = {
        ...get().settings,
        ...partial,
        updates: {
          ...get().settings.updates,
          ...(partial.updates ?? {})
        }
      }
      // Sanitize queryLimit to match the server-side enforced range (1–10000)
      const rawLimit = Number(merged.queryLimit)
      const queryLimit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(10000, Math.floor(rawLimit)))
        : get().settings.queryLimit
      const rawInterval = Number(merged.updates.checkIntervalHours)
      const checkIntervalHours = Number.isFinite(rawInterval)
        ? Math.max(6, Math.min(168, Math.floor(rawInterval)))
        : get().settings.updates.checkIntervalHours
      const next = {
        ...merged,
        queryLimit,
        updates: {
          ...merged.updates,
          autoCheckEnabled: !!merged.updates.autoCheckEnabled,
          checkIntervalHours
        }
      }
      set((s) => {
        s.settings = next
      })
      try {
        await window.db.saveSettings(next)
        await get().loadUpdateStatus()
      } catch {/* ignore */}
    },

    loadUpdateStatus: async () => {
      try {
        const status = await window.db.getUpdateStatus()
        set((s) => {
          s.updateStatus = status
        })
      } catch {/* ignore */}
    },

    checkForUpdatesNow: async () => {
      try {
        const status = await window.db.checkForUpdatesNow()
        if (status) {
          set((s) => {
            s.updateStatus = status
          })
          if (status.updateAvailable) {
            const version = (status.latestVersion ?? '').replace(/^v/i, '')
            get().setStatus(`Update available: v${version}`, 'info')
          } else if (status.error) {
            get().setStatus(status.error, 'warning')
          } else {
            get().setStatus('You are up to date', 'success')
          }
        }
      } catch (error) {
        get().setStatus(getErrorMessage(error), 'error')
      }
    },

    ignoreUpdateVersion: async (version) => {
      try {
        const status = await window.db.ignoreUpdateVersion(version)
        if (status) {
          set((s) => {
            s.updateStatus = status
          })
        }
      } catch (error) {
        get().setStatus(getErrorMessage(error), 'error')
      }
    },

    dismissUpdateVersion: async (version) => {
      try {
        const status = await window.db.dismissUpdateVersion(version)
        if (status) {
          set((s) => {
            s.updateStatus = status
          })
        }
      } catch (error) {
        get().setStatus(getErrorMessage(error), 'error')
      }
    },

    openUpdateRelease: async (url) => {
      try {
        const result = await window.db.openUpdateRelease(url)
        if (result?.success) {
          get().setStatus('Opened release page', 'info')
        } else {
          get().setStatus('Failed to open release page', 'warning')
        }
      } catch (error) {
        get().setStatus(getErrorMessage(error), 'error')
      }
    },

    downloadUpdate: async () => {
      let pollTimer: number | undefined
      const stopPolling = () => {
        if (pollTimer !== undefined) {
          window.clearInterval(pollTimer)
          pollTimer = undefined
        }
      }
      const syncStatus = async () => {
        try {
          const polledStatus = await window.db.getUpdateStatus()
          if (polledStatus) {
            set((s) => {
              s.updateStatus = polledStatus
            })
            if (polledStatus.downloadState && polledStatus.downloadState !== 'downloading') {
              stopPolling()
            }
          }
        } catch (error) {
          console.debug('Failed to poll update download status', error)
        }
      }
      try {
        set((s) => {
          if (s.updateStatus) {
            s.updateStatus.downloadState = 'downloading'
            s.updateStatus.downloadProgress = 0
            s.updateStatus.downloadError = undefined
          }
        })
        pollTimer = window.setInterval(() => {
          void syncStatus()
        }, UPDATE_DOWNLOAD_POLL_MS)
        const status = await window.db.downloadUpdate()
        stopPolling()
        if (status) {
          set((s) => {
            s.updateStatus = status
          })
          if (status.downloadState === 'error') {
            get().setStatus(status.downloadError ?? 'Download failed', 'error')
          }
        }
      } catch (error) {
        stopPolling()
        const message = getErrorMessage(error)
        set((s) => {
          if (s.updateStatus) {
            s.updateStatus.downloadState = 'error'
            s.updateStatus.downloadError = message
          }
        })
        get().setStatus(message, 'error')
      }
    },

    installUpdate: async () => {
      try {
        const result = await window.db.installUpdate()
        if (!result?.success) {
          get().setStatus(result?.error ?? 'Install failed', 'error')
        }
      } catch (error) {
        get().setStatus(getErrorMessage(error), 'error')
      }
    },

    setSidebarWidth: (w) => {
      set((s) => {
        s.sidebarWidth = w
      })
    },

    setSidebarCollapsed: (v) => {
      set((s) => {
        s.isSidebarCollapsed = v
      })
    },

    setTheme: (t) => {
      set((s) => {
        s.theme = t
      })
      try {
        localStorage.setItem(THEME_STORAGE_KEY, t)
      } catch {/* ignore */}
    },

    setStatus: (msg, type = 'info') => {
      set((s) => {
        s.statusMessage = msg
        s.statusType = type
      })
      // Auto-clear error and success messages so they don't persist forever
      if (msg !== null && (type === 'error' || type === 'success')) {
        setTimeout(() => {
          set((s) => {
            if (s.statusMessage === msg) {
              s.statusMessage = null
            }
          })
        }, 6000)
      }
    }
  }))
)

// Register the connection-lost push listener so the UI reflects unexpected disconnections
if (typeof window !== 'undefined' && window.db?.onConnectionLost) {
  const runtimeWindow = window as Window & { __kobeansqlConnectionLostUnsubscribe?: () => void }
  runtimeWindow.__kobeansqlConnectionLostUnsubscribe?.()
  runtimeWindow.__kobeansqlConnectionLostUnsubscribe = window.db.onConnectionLost((connectionId: string) => {
    useAppStore.getState().handleConnectionLost(connectionId)
  })
}
