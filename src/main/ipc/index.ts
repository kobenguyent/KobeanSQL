import { BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent, shell } from 'electron'
import path from 'path'
import { ConnectionManager } from '../db/manager'
import {
  exportConnectionsToPath,
  importConnectionsFromPath,
  loadConnections,
  loadSavedQueries,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  saveConnections,
  writeSavedQueries,
  deleteSavedQuery
} from '../store'
import { ConnectionConfig } from '../db/types'
import { appLogger } from '../logger'
import { AIService, type AIRequest, type AIProvider } from '../ai/service'
import { isTrustedRendererUrl } from '../security'
import type { UpdateService } from '../update/service'
import { localStore, type ConnectionLogEntry, type PersistedQueryHistoryEntry, type DashboardLayoutRecord } from '../local-store'

class UntrustedRendererContextError extends Error {
  constructor() {
    super('Untrusted renderer context')
  }
}

export function registerIpcHandlers(manager: ConnectionManager, updateService?: UpdateService): void {
  const aiService = new AIService()
  const debugChannels = new Set(['db:query'])

  // Forward unexpected connection-lost events from the manager to all renderer windows
  manager.on('connection-lost', (connectionId: string) => {
    appLogger.info('Forwarding connection-lost event to renderer', { connectionId })
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      try {
        win.webContents.send('db:connection-lost', connectionId)
      } catch (error) {
        appLogger.warn('Failed to forward connection-lost event', {
          connectionId,
          error: (error as Error).message
        })
      }
    })
  })

  const handleWithLogging = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: (_event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult
  ): void => {
    ipcMain.handle(channel, async (event, ...args: TArgs) => {
      try {
        if (!event.senderFrame || !isTrustedRendererUrl(event.senderFrame.url)) {
          appLogger.warn('Blocked IPC call from untrusted sender', {
            channel,
            senderUrl: event.senderFrame?.url
          })
          throw new UntrustedRendererContextError()
        }

        if (debugChannels.has(channel)) {
          appLogger.debug('IPC request', { channel })
        } else {
          appLogger.info('IPC request', { channel })
        }
        return await handler(event, ...args)
      } catch (error) {
        if (error instanceof UntrustedRendererContextError) {
          throw error
        }
        appLogger.error('IPC handler failed', {
          channel,
          error: (error as Error).message,
          stack: (error as Error).stack
        })
        throw error
      }
    })
  }

  // List saved connections
  handleWithLogging('db:get-connections', async (_event: IpcMainInvokeEvent) => {
    return loadConnections()
  })

  // Save a connection (add or update)
  handleWithLogging('db:save-connection', async (_event: IpcMainInvokeEvent, config: ConnectionConfig) => {
    const connections = loadConnections()
    const idx = connections.findIndex((c) => c.id === config.id)
    if (idx >= 0) {
      connections[idx] = config
    } else {
      connections.push(config)
    }
    saveConnections(connections)
    return { success: true }
  })

  // Delete a connection
  handleWithLogging('db:delete-connection', async (_event: IpcMainInvokeEvent, connectionId: string) => {
    const connections = loadConnections().filter((c) => c.id !== connectionId)
    saveConnections(connections)
    await manager.disconnect(connectionId)
    return { success: true }
  })

  // Test connection (without saving)
  handleWithLogging('db:test-connection', async (_event: IpcMainInvokeEvent, config: ConnectionConfig) => {
    return manager.testConnection(config)
  })

  // Connect to a database
  handleWithLogging('db:connect', async (_event: IpcMainInvokeEvent, config: ConnectionConfig) => {
    return manager.connect(config)
  })

  // Disconnect
  handleWithLogging('db:disconnect', async (_event: IpcMainInvokeEvent, connectionId: string) => {
    await manager.disconnect(connectionId)
    return { success: true }
  })

  // Check if connected
  handleWithLogging('db:is-connected', async (_event: IpcMainInvokeEvent, connectionId: string) => {
    return manager.isConnected(connectionId)
  })

  // Execute a SQL query
  handleWithLogging(
    'db:query',
    async (_event: IpcMainInvokeEvent, connectionId: string, sql: string, params?: unknown[]) => {
      return manager.query(connectionId, sql, params)
    }
  )

  // Mock delete row
  handleWithLogging(
    'db:delete-row',
    async (_event: IpcMainInvokeEvent, _tableName: string, _primaryKeyObject: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return true
    }
  )

  // Mock insert row
  handleWithLogging(
    'db:insert-row',
    async (_event: IpcMainInvokeEvent, _tableName: string, _rowData: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return true
    }
  )

  // Mock duplicate row
  handleWithLogging(
    'db:duplicate-row',
    async (_event: IpcMainInvokeEvent, _tableName: string, _primaryKeyObject: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return true
    }
  )

  // Get databases list
  handleWithLogging('db:get-databases', async (_event: IpcMainInvokeEvent, connectionId: string) => {
    return manager.getDatabases(connectionId)
  })

  // Get tables list
  handleWithLogging(
    'db:get-tables',
    async (_event: IpcMainInvokeEvent, connectionId: string, database?: string) => {
      return manager.getTables(connectionId, database)
    }
  )

  // Get columns for a table
  handleWithLogging(
    'db:get-columns',
    async (_event: IpcMainInvokeEvent, connectionId: string, table: string, database?: string) => {
      return manager.getColumns(connectionId, table, database)
    }
  )

  // Get foreign keys for a table
  handleWithLogging(
    'db:get-fks',
    async (_event: IpcMainInvokeEvent, connectionId: string, table: string, database?: string) => {
      return manager.getForeignKeys(connectionId, table, database)
    }
  )

  // Get full database schema (tables + columns + FK relationships) for the visualizer
  handleWithLogging(
    'db:get-schema',
    async (_event: IpcMainInvokeEvent, connectionId: string, database?: string) => {
      const tableInfos = await manager.getTables(connectionId, database)

      // Safeguard: Limit the number of tables processed for the visualizer to prevent OOM/hangs
      const MAX_SCHEMA_TABLES = 200
      const tablesToProcess = tableInfos.slice(0, MAX_SCHEMA_TABLES)

      // Safeguard: Process tables in batches to avoid overwhelming the DB server
      const BATCH_SIZE = 10
      const schemaRows: Array<{
        tableInfo: typeof tableInfos[0],
        tableId: string,
        columns: Awaited<ReturnType<typeof manager.getColumns>>,
        fks: Awaited<ReturnType<typeof manager.getForeignKeys>>
      }> = []

      for (let i = 0; i < tablesToProcess.length; i += BATCH_SIZE) {
        const batch = tablesToProcess.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async (t) => {
            const tableId = t.schema ? `${t.schema}.${t.name}` : t.name
            const [columns, fks] = await Promise.all([
              manager.getColumns(connectionId, tableId, database),
              manager.getForeignKeys(connectionId, tableId, database)
            ])
            return { tableInfo: t, tableId, columns, fks }
          })
        )
        schemaRows.push(...batchResults)
      }

      const fkColumnSet = new Set<string>()
      schemaRows.forEach(({ tableId, fks }) => {
        fks.forEach((fk) => fkColumnSet.add(`${tableId}.${fk.columnName}`))
      })

      const tables = schemaRows.map(({ tableId, tableInfo, columns }) => ({
        id: tableId,
        name: tableInfo.schema ? tableId : tableInfo.name,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          isPrimaryKey: c.primaryKey,
          isForeignKey: fkColumnSet.has(`${tableId}.${c.name}`)
        }))
      }))

      const relationships = schemaRows.flatMap(({ tableId, fks }) =>
        fks.map((fk) => ({
          id: `${tableId}.${fk.columnName}→${fk.referencedTable}.${fk.referencedColumn}`,
          sourceTable: tableId,
          sourceColumn: fk.columnName,
          targetTable: fk.referencedTable,
          targetColumn: fk.referencedColumn
        }))
      )

      return {
        tables,
        relationships,
        truncated: tableInfos.length > MAX_SCHEMA_TABLES
      }
    }
  )


  // Get procedures / functions list
  handleWithLogging(
    'db:get-procedures',
    async (_event: IpcMainInvokeEvent, connectionId: string, database?: string) => {
      return manager.getProcedures(connectionId, database)
    }
  )

  // Saved queries
  handleWithLogging('queries:get', async () => {
    return loadSavedQueries()
  })

  handleWithLogging(
    'queries:save',
    async (_event: IpcMainInvokeEvent, query: { id: string; name: string; sql: string; createdAt: number }) => {
      const queries = loadSavedQueries()
      const idx = queries.findIndex((q) => q.id === query.id)
      if (idx >= 0) {
        queries[idx] = query
      } else {
        queries.push(query)
      }
      writeSavedQueries(queries)
      return { success: true }
    }
  )

  handleWithLogging('queries:delete', async (_event: IpcMainInvokeEvent, id: string) => {
    deleteSavedQuery(id)
    return { success: true }
  })

  handleWithLogging('ai:get-settings', async () => {
    const settings = loadSettings()
    if (settings.ai) {
      return { ...settings.ai, localOnly: true as const }
    }
    return aiService.getSettings()
  })
  handleWithLogging('ai:run-task', async (_event: IpcMainInvokeEvent, request: AIRequest) => {
    const s = loadSettings().ai
    const svc = s ? new AIService(s.provider, s.baseUrl, s.model) : aiService
    return svc.runTask(request)
  })

  handleWithLogging(
    'ai:list-models',
    async (_event: IpcMainInvokeEvent, req?: { provider?: AIProvider; baseUrl?: string }) => {
      const s = loadSettings().ai
      const provider = req?.provider ?? s?.provider ?? 'ollama'
      const baseUrl = req?.baseUrl?.trim() || s?.baseUrl || (provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234/v1')
      
      const err = AIService.validateUrl(baseUrl)
      if (err) return { success: false, models: [], error: err }

      try {
        const isOllama = provider === 'ollama'
        const endpoint = isOllama ? `${baseUrl.replace(/\/+$/, '')}/api/tags` : `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/models`
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`Provider returned ${res.status}`)
        const data = await res.json()
        const models = isOllama ? (data.models || []).map(m => m.name) : (data.data || []).map(m => m.id)
        return { success: true, models: models.filter(Boolean) }
      } catch (err) {
        return { success: false, models: [], error: (err as Error).message }
      }
    }
  )

  handleWithLogging('db:export-connections', async (_event: IpcMainInvokeEvent, includePasswords = false) => {
    const result = await dialog.showSaveDialog({
      title: 'Export connections',
      defaultPath: `kobeansql-connections-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }
    try {
      const count = exportConnectionsToPath(result.filePath, includePasswords as boolean)
      appLogger.info('Connections exported', { filePath: result.filePath, count, includePasswords })
      return { success: true, count, path: result.filePath }
    } catch (error) {
      appLogger.error('Failed to export connections', { error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  })

  handleWithLogging('db:import-connections', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import connections',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }
    try {
      const importResult = importConnectionsFromPath(result.filePaths[0])
      appLogger.info('Connections imported', { filePath: result.filePaths[0], ...importResult })
      return { success: true, ...importResult }
    } catch (error) {
      appLogger.error('Failed to import connections', { error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  })

  handleWithLogging('app:get-log-path', async () => {
    return appLogger.getFilePath()
  })

  handleWithLogging('app:open-logs', async () => {
    const logPath = appLogger.getFilePath()
    const openError = await shell.openPath(path.dirname(logPath))
    if (openError) {
      throw new Error(openError)
    }
    return { success: true, path: logPath }
  })

  handleWithLogging('settings:get', async () => {
    return loadSettings()
  })

  handleWithLogging('settings:save', async (_event: IpcMainInvokeEvent, settings: unknown) => {
    saveSettings(sanitizeSettings(settings))
    updateService?.reschedule()
    return { success: true }
  })

  handleWithLogging('db:get-server-version', async (_event: IpcMainInvokeEvent, connectionId: string) => {
    try {
      return { version: await manager.getServerVersion(connectionId) }
    } catch (err) {
      return { version: 'Unknown' }
    }
  })

  handleWithLogging('updates:get-status', async () => {
    return updateService?.getStatus() ?? null
  })

  handleWithLogging('updates:check-now', async () => {
    if (!updateService) return null
    return updateService.checkForUpdates(true)
  })

  handleWithLogging('updates:ignore-version', async (_event: IpcMainInvokeEvent, version?: string) => {
    if (!updateService) return null
    return updateService.ignoreVersion(version)
  })

  handleWithLogging('updates:dismiss-version', async (_event: IpcMainInvokeEvent, version?: string) => {
    if (!updateService) return null
    return updateService.dismissVersion(version)
  })

  handleWithLogging('updates:open-release', async (_event: IpcMainInvokeEvent, url?: string) => {
    if (!updateService) return { success: false, url: '' }
    return updateService.openReleasePage(url)
  })

  handleWithLogging('updates:download', async () => {
    if (!updateService) return null
    return updateService.downloadUpdate()
  })

  handleWithLogging('updates:install', async () => {
    if (!updateService) return { success: false, error: 'Update service unavailable' }
    return updateService.installUpdate()
  })

  // -------------------------------------------------------------------------
  // Connection logs
  // -------------------------------------------------------------------------

  handleWithLogging(
    'logs:add-connection-log',
    async (_event: IpcMainInvokeEvent, entry: ConnectionLogEntry) => {
      localStore.addConnectionLog(entry)
      return { success: true }
    }
  )

  handleWithLogging(
    'logs:get-connection-logs',
    async (_event: IpcMainInvokeEvent, connectionId?: string, limit?: number) => {
      return localStore.getConnectionLogs(connectionId, limit)
    }
  )

  handleWithLogging(
    'logs:clear-connection-logs',
    async (_event: IpcMainInvokeEvent, connectionId?: string) => {
      localStore.clearConnectionLogs(connectionId)
      return { success: true }
    }
  )

  // -------------------------------------------------------------------------
  // Persistent query history
  // -------------------------------------------------------------------------

  handleWithLogging(
    'history:add',
    async (_event: IpcMainInvokeEvent, entry: PersistedQueryHistoryEntry) => {
      localStore.addQueryHistory(entry)
      return { success: true }
    }
  )

  handleWithLogging('history:get', async (_event: IpcMainInvokeEvent, limit?: number) => {
    return localStore.getQueryHistory(limit)
  })

  handleWithLogging('history:clear', async () => {
    localStore.clearQueryHistory()
    return { success: true }
  })

  // -------------------------------------------------------------------------
  // Schema cache
  // -------------------------------------------------------------------------

  handleWithLogging(
    'schema-cache:set',
    async (
      _event: IpcMainInvokeEvent,
      connectionId: string,
      databaseName: string,
      schemaJson: string
    ) => {
      localStore.setSchemaCache(connectionId, databaseName, schemaJson)
      return { success: true }
    }
  )

  handleWithLogging(
    'schema-cache:get',
    async (_event: IpcMainInvokeEvent, connectionId: string, databaseName: string) => {
      return localStore.getSchemaCache(connectionId, databaseName)
    }
  )

  handleWithLogging(
    'schema-cache:clear',
    async (_event: IpcMainInvokeEvent, connectionId?: string) => {
      localStore.clearSchemaCache(connectionId)
      return { success: true }
    }
  )

  // -------------------------------------------------------------------------
  // Metrics data
  // -------------------------------------------------------------------------

  handleWithLogging(
    'metrics:get-data',
    async (_event: IpcMainInvokeEvent, connectionId: string, metricId: string, params?: { points?: number }) => {
      // Return real collected metric data from localStore
      const points = params?.points ?? 20
      const data = localStore.getMetricTimeSeries(connectionId, metricId, points)
      return { metricId, data }
    }
  )

  // -------------------------------------------------------------------------
  // Dashboard layouts
  // -------------------------------------------------------------------------

  handleWithLogging('dashboard:get-layouts', async () => {
    return localStore.getDashboardLayouts()
  })

  handleWithLogging(
    'dashboard:save-layout',
    async (_event: IpcMainInvokeEvent, layout: DashboardLayoutRecord) => {
      localStore.saveDashboardLayout(layout)
      return { success: true }
    }
  )

  handleWithLogging(
    'dashboard:delete-layout',
    async (_event: IpcMainInvokeEvent, id: string) => {
      localStore.deleteDashboardLayout(id)
      return { success: true }
    }
  )
}
