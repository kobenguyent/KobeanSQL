import React, { useState, useCallback, useRef } from 'react'
import {
  Plus,
  Copy,
  ChevronRight,
  ChevronDown,
  Database,
  Table,
  Eye,
  Columns,
  Trash2,
  Power,
  PowerOff,
  Search,
  Code2,
  FunctionSquare,
  BookOpen,
  Pencil,
  Check,
  Folder,
  Upload,
  Download
} from 'lucide-react'
import { useAppStore } from '../../store'
import { useTranslation } from '../../hooks/useTranslation'
import type { ConnectionConfig, SavedQuery } from '../../types'
import { DB_COLORS } from '../../types'
import { CopyTableModal } from '../CopyTableModal'

interface Props {
  onNewConnection: () => void
  onEditConnection: (config: ConnectionConfig) => void
}

interface TreeState {
  expandedConnections: Set<string>
  expandedDatabases: Record<string, Set<string>>
  expandedTables: Record<string, Set<string>>
  expandedSections: Record<string, Set<string>> // key: `connId/dbName`, value: Set of section names
  selectedTable: string | null
  dbSearch: Record<string, string> // key: `connId/dbName`, value: search text
}

interface CopyTableState {
  connectionId: string
  connectionName: string
  databaseType: ConnectionConfig['type']
  sourceTable: string
  sourceDatabase?: string
  sourceSchema?: string
}

const UNGROUPED_CATEGORY_KEY = ''

const normalizeCategoryKey = (category?: string | null): string => category?.trim() || UNGROUPED_CATEGORY_KEY
const isUngroupedCategory = (categoryKey: string): boolean => categoryKey === UNGROUPED_CATEGORY_KEY
const SQL_TEMPLATES = [
  {
    id: 'select-all',
    name: 'Select all rows',
    sql: 'SELECT *\nFROM {table}\nLIMIT 100;'
  },
  {
    id: 'insert-row',
    name: 'Insert row',
    sql: 'INSERT INTO {table} (column1, column2)\nVALUES (value1, value2);'
  },
  {
    id: 'update-row',
    name: 'Update rows',
    sql: 'UPDATE {table}\nSET column1 = value1\nWHERE condition;'
  },
  {
    id: 'delete-row',
    name: 'Delete rows',
    sql: 'DELETE FROM {table}\nWHERE condition;'
  },
  {
    id: 'count-rows',
    name: 'Count rows',
    sql: 'SELECT COUNT(*) AS total_rows\nFROM {table};'
  }
]

export function Sidebar({ onNewConnection, onEditConnection }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const {
    connections,
    connectedIds,
    schema,
    connectionCapabilities,
    savedQueries,
    connect,
    disconnect,
    deleteConnection,
    loadTables,
    loadColumns,
    loadProcedures,
    openTableInTab,
    openProcedureInTab,
    deleteSavedQuery,
    openSavedQuery,
    updateSavedQuery,
    newTab,
    updateTabSql,
    setStatus,
    importConnections,
    exportConnections
  } = useAppStore()

  const [templatesExpanded, setTemplatesExpanded] = useState(true)
  const [savedQueriesExpanded, setSavedQueriesExpanded] = useState(true)
  const [renamingQueryId, setRenamingQueryId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenameSubmitting, setIsRenameSubmitting] = useState(false)
  const [expandedQueryCategories, setExpandedQueryCategories] = useState<Set<string>>(new Set([UNGROUPED_CATEGORY_KEY]))
  const [expandedConnCategories, setExpandedConnCategories] = useState<Set<string>>(new Set([UNGROUPED_CATEGORY_KEY]))
  const isRenameSubmittingRef = useRef(false)
  const [copyTableState, setCopyTableState] = useState<CopyTableState | null>(null)

  const [tree, setTree] = useState<TreeState>({
    expandedConnections: new Set(),
    expandedDatabases: {},
    expandedTables: {},
    expandedSections: {},
    selectedTable: null,
    dbSearch: {}
  })

  const toggleConnection = useCallback(
    async (conn: ConnectionConfig) => {
      const isExpanded = tree.expandedConnections.has(conn.id)
      if (isExpanded) {
        setTree((prev) => {
          const s = new Set(prev.expandedConnections)
          s.delete(conn.id)
          return { ...prev, expandedConnections: s }
        })
      } else {
        if (!connectedIds.has(conn.id)) {
          await connect(conn)
        }
        setTree((prev) => {
          const s = new Set(prev.expandedConnections)
          s.add(conn.id)
          return { ...prev, expandedConnections: s }
        })
      }
    },
    [tree.expandedConnections, connectedIds, connect]
  )

  const toggleDatabase = useCallback(
    async (connId: string, dbName: string) => {
      const expanded = tree.expandedDatabases[connId] ?? new Set<string>()
      const isExpanded = expanded.has(dbName)
      setTree((prev) => {
        const newSet = new Set(prev.expandedDatabases[connId] ?? new Set<string>())
        if (isExpanded) {
          newSet.delete(dbName)
        } else {
          newSet.add(dbName)
        }
        return {
          ...prev,
          expandedDatabases: { ...prev.expandedDatabases, [connId]: newSet }
        }
      })
      if (!isExpanded) {
        await loadTables(connId, dbName)
        await loadProcedures(connId, dbName)
      }
    },
    [tree.expandedDatabases, loadTables, loadProcedures]
  )

  const toggleTable = useCallback(
    async (connId: string, tableName: string, dbName: string, tableSchema?: string) => {
      const qualifiedTableName = tableSchema ? `${tableSchema}.${tableName}` : tableName
      const key = `${connId}/${dbName}/${qualifiedTableName}`
      const expanded = tree.expandedTables[connId] ?? new Set<string>()
      const isExpanded = expanded.has(key)
      setTree((prev) => {
        const newSet = new Set(prev.expandedTables[connId] ?? new Set<string>())
        if (isExpanded) {
          newSet.delete(key)
        } else {
          newSet.add(key)
        }
        return {
          ...prev,
          expandedTables: { ...prev.expandedTables, [connId]: newSet },
          selectedTable: isExpanded ? null : key
        }
      })
      if (!isExpanded) {
        await loadColumns(connId, qualifiedTableName, dbName)
      }
    },
    [tree.expandedTables, loadColumns]
  )

  const toggleSection = useCallback((connId: string, dbName: string, section: string) => {
    const sectionKey = `${connId}/${dbName}`
    setTree((prev) => {
      const current = new Set(prev.expandedSections[sectionKey] ?? new Set<string>())
      if (current.has(section)) {
        current.delete(section)
      } else {
        current.add(section)
      }
      return {
        ...prev,
        expandedSections: { ...prev.expandedSections, [sectionKey]: current }
      }
    })
  }, [])

  const setDbSearch = useCallback((connId: string, dbName: string, value: string) => {
    const key = `${connId}/${dbName}`
    setTree((prev) => ({
      ...prev,
      dbSearch: { ...prev.dbSearch, [key]: value }
    }))
  }, [])

  const handleOpenTableData = useCallback(
    async (connId: string, tableName: string, dbName: string, tableSchema?: string) => {
      await openTableInTab(connId, tableName, dbName, tableSchema)
    },
    [openTableInTab]
  )

  const handleOpenProcedure = useCallback(
    (connId: string, proc: import('../../types').ProcedureInfo) => {
      openProcedureInTab(connId, proc)
    },
    [openProcedureInTab]
  )

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleCopyTableSuccess = useCallback(async (targetTable: string) => {
    if (copyTableState?.sourceDatabase) {
      await loadTables(copyTableState.connectionId, copyTableState.sourceDatabase)
    }
    setStatus(`Copied table to ${targetTable} successfully.`, 'success')
  }, [copyTableState, loadTables, setStatus])

  const applyTemplate = useCallback((sql: string) => {
    const state = useAppStore.getState()
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId)

    // Resolve the active table name for {table} placeholder substitution.
    // Priority: (1) table name from the active tab, (2) selected table in the tree.
    let resolvedTable = ''
    if (activeTab?.tabType === 'table') {
      resolvedTable = activeTab.tableName ?? activeTab.title
    } else if (tree.selectedTable) {
      // tree.selectedTable is "connId/dbName/tableName" or "connId/dbName/schema.tableName"
      const parts = tree.selectedTable.split('/')
      resolvedTable = parts[parts.length - 1] ?? ''
    }

    const resolvedSql = resolvedTable
      ? sql.replaceAll('{table}', resolvedTable)
      : sql

    const isQueryTab = activeTab?.tabType === 'query'
    const targetTabId = isQueryTab
      ? activeTab!.id
      : newTab(activeTab?.connectionId ?? null)
    const tab = useAppStore.getState().tabs.find((t) => t.id === targetTabId)
    const trimmedSql = (tab?.sql ?? '').trimEnd()
    const nextSql = trimmedSql ? `${trimmedSql}\n\n${resolvedSql}` : resolvedSql
    updateTabSql(targetTabId, nextSql)
    setStatus('SQL template inserted', 'success')
  }, [newTab, setStatus, updateTabSql, tree.selectedTable])

  const cancelRename = useCallback(() => {
    setRenamingQueryId(null)
    setRenameValue('')
  }, [])

  const commitRename = useCallback(
    async (query: SavedQuery) => {
      if (isRenameSubmittingRef.current) {
        return
      }
      const nextName = renameValue.trim()
      if (!nextName || nextName === query.name) {
        cancelRename()
        return
      }
      isRenameSubmittingRef.current = true
      setIsRenameSubmitting(true)
      try {
        await updateSavedQuery({ ...query, name: nextName })
        cancelRename()
      } catch (error) {
        console.error('Failed to rename saved query', {
          queryId: query.id,
          queryName: query.name,
          attemptedName: nextName,
          error
        })
      } finally {
        isRenameSubmittingRef.current = false
        setIsRenameSubmitting(false)
      }
    },
    [renameValue, updateSavedQuery, cancelRename]
  )

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{t('sidebar.connections')}</span>
        <button
          className="icon-btn"
          onClick={onNewConnection}
          data-tooltip={t('sidebar.newConnection')}
        >
          <Plus size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => importConnections()}
          data-tooltip={t('sidebar.importConnections')}
        >
          <Upload size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => exportConnections(false)}
          data-tooltip={connections.length === 0 ? undefined : t('sidebar.exportConnections')}
          disabled={connections.length === 0}
        >
          <Download size={14} />
        </button>
      </div>

      <div className="sidebar-body">
        {connections.length === 0 && (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <Database size={32} className="empty-state-icon" />
            <span className="empty-state-title">{t('sidebar.noConnections')}</span>
            <span className="empty-state-sub">{t('sidebar.noConnectionsSub')}</span>
            <button className="btn btn-primary btn-sm" onClick={onNewConnection} style={{ marginTop: 8 }}>
              <Plus size={12} /> {t('sidebar.addConnection')}
            </button>
          </div>
        )}

        {/* Group connections by category */}
        {(() => {
          const grouped: Record<string, ConnectionConfig[]> = {}
          for (const conn of connections) {
            const cat = normalizeCategoryKey(conn.category)
            if (!grouped[cat]) grouped[cat] = []
            grouped[cat].push(conn)
          }
          const categories = Object.keys(grouped).sort((a, b) => {
            if (isUngroupedCategory(a)) return 1
            if (isUngroupedCategory(b)) return -1
            return a.localeCompare(b)
          })
          const hasManyCategories =
            categories.length > 1 || (categories.length === 1 && !isUngroupedCategory(categories[0]))

          return categories.map((cat) => {
            const catConns = grouped[cat]
            const isCatExpanded = expandedConnCategories.has(cat)
            const toggleCat = () => setExpandedConnCategories((prev) => {
              const next = new Set(prev)
              if (next.has(cat)) next.delete(cat)
              else next.add(cat)
              return next
            })

            return (
              <div key={cat}>
                {hasManyCategories && !isUngroupedCategory(cat) && (
                  <button
                    type="button"
                    className="tree-item"
                    style={{
                      fontWeight: 600,
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      cursor: 'pointer',
                      userSelect: 'none',
                      paddingLeft: 14,
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left'
                    }}
                    onClick={toggleCat}
                    aria-expanded={isCatExpanded}
                  >
                    {isCatExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    <Folder size={10} style={{ opacity: 0.7 }} />
                    <span>{cat}</span>
                  </button>
                )}
                {(isUngroupedCategory(cat) || !hasManyCategories || isCatExpanded) && catConns.map((conn) => {
                  const isConnected = connectedIds.has(conn.id)
                  const isExpanded = tree.expandedConnections.has(conn.id)
                  const connSchema = schema[conn.id]
                  const color = conn.color ?? DB_COLORS[conn.type]

                  return (
                    <div key={conn.id}>
                      {/* Connection row */}
                      <div
                        className={`connection-item ${isExpanded ? 'active' : ''}`}
                        onClick={() => toggleConnection(conn)}
                        onContextMenu={handleContextMenu}
                      >
                        <span
                          className={`connection-dot ${isConnected ? 'connected' : ''}`}
                          style={{ background: isConnected ? color : undefined }}
                        />

                        <ChevronRight
                          size={12}
                          style={{
                            transition: 'transform 200ms ease',
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            color: 'var(--text-tertiary)',
                            flexShrink: 0
                          }}
                        />

                        <span className="connection-name">{conn.name}</span>

                        <span
                          className="connection-type-badge"
                          style={{ color, background: `${color}15`, border: `1px solid ${color}40` }}
                        >
                          {conn.type === 'postgres' ? 'PG' : conn.type.toUpperCase().slice(0, 4)}
                        </span>

                        {/* Actions (shown on hover via CSS opacity trick) */}
                        <span style={{ display: 'flex', gap: 2 }} className="conn-actions">
                          <button
                            className="icon-btn"
                            style={{ width: 20, height: 20 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isConnected) disconnect(conn.id)
                              else connect(conn)
                            }}
                            title={isConnected ? 'Disconnect' : 'Connect'}
                          >
                            {isConnected ? <PowerOff size={10} /> : <Power size={10} />}
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 20, height: 20 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onEditConnection(conn)
                            }}
                            title="Edit"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 20, height: 20 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteConnection(conn.id)
                            }}
                            title="Delete"
                          >
                            <Trash2 size={10} />
                          </button>
                        </span>
                      </div>

                      {/* Databases */}
                      {isExpanded && connSchema && (
                        <div>
                          {connSchema.loadingDatabases ? (
                            <div className="tree-item">
                              <span className="spinner" />
                              {t('common.loading')}
                            </div>
                          ) : (
                            connSchema.databases.map((dbName) => {
                              const dbExpanded = (tree.expandedDatabases[conn.id] ?? new Set()).has(dbName)
                              const allTables = connSchema.tables[dbName] ?? []
                              const procedures = connSchema.procedures[dbName] ?? []
                              const loadingTables = connSchema.loadingTables[dbName]
                              const loadingProcedures = connSchema.loadingProcedures[dbName]
                              const sectionKey = `${conn.id}/${dbName}`
                      const expandedSections = tree.expandedSections[sectionKey] ?? new Set<string>()
                      const searchText = (tree.dbSearch[sectionKey] ?? '').toLowerCase()

                      const tables = allTables.filter((t) => t.type === 'table')
                      const views = allTables.filter((t) => t.type === 'view')

                      const filteredTables = searchText
                        ? tables.filter((t) => t.name.toLowerCase().includes(searchText))
                        : tables
                      const filteredViews = searchText
                        ? views.filter((v) => v.name.toLowerCase().includes(searchText))
                        : views
                      const filteredProcedures = searchText
                        ? procedures.filter((p) => p.name.toLowerCase().includes(searchText))
                        : procedures

                      const tablesExpanded = expandedSections.has('tables')
                      const viewsExpanded = expandedSections.has('views')
                      const proceduresExpanded = expandedSections.has('procedures')

                      return (
                        <div key={dbName}>
                          <div
                            className="tree-item"
                            onClick={() => toggleDatabase(conn.id, dbName)}
                          >
                            {dbExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                            <Database size={12} style={{ color: color, opacity: 0.8 }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {dbName}
                            </span>
                          </div>

                          {dbExpanded && (
                            <div>
                              {/* Search box */}
                              <div style={{ padding: '4px 8px 4px 24px' }}>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: 'var(--bg-tertiary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: 4,
                                  padding: '2px 6px'
                                }}>
                                  <Search size={10} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                  <input
                                    type="text"
                                    placeholder="Search..."
                                    value={tree.dbSearch[sectionKey] ?? ''}
                                    onChange={(e) => setDbSearch(conn.id, dbName, e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      outline: 'none',
                                      fontSize: 11,
                                      color: 'var(--text-primary)',
                                      width: '100%',
                                      padding: 0
                                    }}
                                  />
                                  {(tree.dbSearch[sectionKey] ?? '') && (
                                    <button
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                                      onClick={(e) => { e.stopPropagation(); setDbSearch(conn.id, dbName, '') }}
                                    >
                                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>✕</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {loadingTables || loadingProcedures ? (
                                <div className="tree-item tree-item-indent-1">
                                  <span className="spinner" />
                                  {t('common.loading')}
                                </div>
                              ) : (
                                <>
                                  {/* Tables section */}
                                  {(filteredTables.length > 0 || !searchText) && (
                                    <div>
                                      <div
                                        className="tree-item tree-item-indent-1"
                                        style={{ fontWeight: 600, fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none' }}
                                        onClick={(e) => { e.stopPropagation(); toggleSection(conn.id, dbName, 'tables') }}
                                      >
                                        {tablesExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        <Table size={10} style={{ opacity: 0.6 }} />
                                        <span>Tables ({filteredTables.length})</span>
                                      </div>
                                      {tablesExpanded && filteredTables.map((tbl) => {
                                        const qualifiedTableName = tbl.schema ? `${tbl.schema}.${tbl.name}` : tbl.name
                                        const tableKey = `${conn.id}/${dbName}/${qualifiedTableName}`
                                        const tblExpanded = (tree.expandedTables[conn.id] ?? new Set()).has(tableKey)
                                        const columns = connSchema.columns[`${dbName}.${qualifiedTableName}`] ?? []
                                        const canCopyTable = conn.type === 'postgres' && !!connectionCapabilities[conn.id]?.canCopyTable

                                        return (
                                          <div key={tableKey}>
                                            <div
                                              className={`tree-item tree-item-indent-2 ${tree.selectedTable === tableKey ? 'selected' : ''}`}
                                              title="Click to view data, click arrow to expand columns"
                                            >
                                              <span
                                                style={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', padding: '0 2px' }}
                                                onClick={(e) => { e.stopPropagation(); toggleTable(conn.id, tbl.name, dbName, tbl.schema) }}
                                              >
                                                {tblExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                              </span>
                                              <span
                                                style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, overflow: 'hidden', cursor: 'pointer' }}
                                                onClick={(e) => { e.stopPropagation(); handleOpenTableData(conn.id, tbl.name, dbName, tbl.schema) }}
                                              >
                                                <Table size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '4px' }}>
                                                  {tbl.name}
                                                </span>
                                                {(tbl.rowCount !== undefined || tbl.engine) && (
                                                  <span
                                                    style={{
                                                      fontSize: '9px',
                                                      color: 'var(--text-tertiary)',
                                                      opacity: 0.7,
                                                      fontFamily: 'var(--font-mono)',
                                                      whiteSpace: 'nowrap',
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis'
                                                    }}
                                                    title={`${tbl.rowCount !== undefined ? tbl.rowCount.toLocaleString() + ' rows' : ''}${tbl.rowCount !== undefined && tbl.engine ? ' • ' : ''}${tbl.engine || ''}`}
                                                  >
                                                    ({tbl.rowCount !== undefined ? tbl.rowCount.toLocaleString() + ' rows' : ''}
                                                    {tbl.rowCount !== undefined && tbl.engine ? ', ' : ''}
                                                    {tbl.engine})
                                                  </span>
                                                )}
                                              </span>
                                              {canCopyTable && (
                                                <button
                                                  className="icon-btn"
                                                  style={{ width: 20, height: 20, flexShrink: 0 }}
                                                  title="Copy table"
                                                  onClick={(event) => {
                                                    event.stopPropagation()
                                                    setCopyTableState({
                                                      connectionId: conn.id,
                                                      connectionName: conn.name,
                                                      databaseType: conn.type,
                                                      sourceTable: tbl.name,
                                                      sourceDatabase: dbName,
                                                      sourceSchema: tbl.schema
                                                    })
                                                  }}
                                                >
                                                  <Copy size={10} />
                                                </button>
                                              )}
                                            </div>

                                            {/* Columns */}
                                            {tblExpanded && columns.map((col) => (
                                              <div
                                                key={col.name}
                                                className="tree-item tree-item-indent-3"
                                                style={{ fontSize: 11 }}
                                              >
                                                <Columns size={10} style={{ opacity: 0.5 }} />
                                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                  {col.name}
                                                </span>
                                                <span style={{
                                                  fontSize: 9,
                                                  color: 'var(--text-tertiary)',
                                                  fontFamily: 'var(--font-mono)'
                                                }}>
                                                  {col.type}
                                                </span>
                                                {col.primaryKey && (
                                                  <span style={{
                                                    fontSize: 8,
                                                    color: 'var(--color-warning)',
                                                    fontWeight: 700
                                                  }}>PK</span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}

                                  {/* Views section */}
                                  {(filteredViews.length > 0 || !searchText) && (
                                    <div>
                                      <div
                                        className="tree-item tree-item-indent-1"
                                        style={{ fontWeight: 600, fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none' }}
                                        onClick={(e) => { e.stopPropagation(); toggleSection(conn.id, dbName, 'views') }}
                                      >
                                        {viewsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        <Eye size={10} style={{ opacity: 0.6 }} />
                                        <span>Views ({filteredViews.length})</span>
                                      </div>
                                      {viewsExpanded && filteredViews.map((tbl) => {
                                        const qualifiedTableName = tbl.schema ? `${tbl.schema}.${tbl.name}` : tbl.name
                                        const tableKey = `${conn.id}/${dbName}/${qualifiedTableName}`
                                        const tblExpanded = (tree.expandedTables[conn.id] ?? new Set()).has(tableKey)
                                        const columns = connSchema.columns[`${dbName}.${qualifiedTableName}`] ?? []

                                        return (
                                          <div key={tableKey}>
                                            <div
                                              className={`tree-item tree-item-indent-2 ${tree.selectedTable === tableKey ? 'selected' : ''}`}
                                              title="Click to view data, click arrow to expand columns"
                                            >
                                              <span
                                                style={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', padding: '0 2px' }}
                                                onClick={(e) => { e.stopPropagation(); toggleTable(conn.id, tbl.name, dbName, tbl.schema) }}
                                              >
                                                {tblExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                              </span>
                                              <span
                                                style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, overflow: 'hidden', cursor: 'pointer' }}
                                                onClick={(e) => { e.stopPropagation(); handleOpenTableData(conn.id, tbl.name, dbName, tbl.schema) }}
                                              >
                                                <Eye size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '4px' }}>
                                                  {tbl.name}
                                                </span>
                                                {tbl.rowCount !== undefined && (
                                                  <span
                                                    style={{
                                                      fontSize: '9px',
                                                      color: 'var(--text-tertiary)',
                                                      opacity: 0.7,
                                                      fontFamily: 'var(--font-mono)',
                                                      whiteSpace: 'nowrap',
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis'
                                                    }}
                                                    title={`${tbl.rowCount.toLocaleString()} rows`}
                                                  >
                                                    ({tbl.rowCount.toLocaleString()} rows)
                                                  </span>
                                                )}
                                              </span>
                                            </div>

                                            {/* Columns */}
                                            {tblExpanded && columns.map((col) => (
                                              <div
                                                key={col.name}
                                                className="tree-item tree-item-indent-3"
                                                style={{ fontSize: 11 }}
                                              >
                                                <Columns size={10} style={{ opacity: 0.5 }} />
                                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                  {col.name}
                                                </span>
                                                <span style={{
                                                  fontSize: 9,
                                                  color: 'var(--text-tertiary)',
                                                  fontFamily: 'var(--font-mono)'
                                                }}>
                                                  {col.type}
                                                </span>
                                                {col.primaryKey && (
                                                  <span style={{
                                                    fontSize: 8,
                                                    color: 'var(--color-warning)',
                                                    fontWeight: 700
                                                  }}>PK</span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}

                                  {/* Procedures section */}
                                  {(filteredProcedures.length > 0 || !searchText) && (
                                    <div>
                                      <div
                                        className="tree-item tree-item-indent-1"
                                        style={{ fontWeight: 600, fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none' }}
                                        onClick={(e) => { e.stopPropagation(); toggleSection(conn.id, dbName, 'procedures') }}
                                      >
                                        {proceduresExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        <Code2 size={10} style={{ opacity: 0.6 }} />
                                        <span>Routines ({filteredProcedures.length})</span>
                                      </div>
                                      {proceduresExpanded && filteredProcedures.map((proc) => {
                                        const qualifiedName = proc.schema ? `${proc.schema}.${proc.name}` : proc.name
                                        const reactKey = proc.specificName ?? qualifiedName
                                        return (
                                          <div
                                            key={reactKey}
                                            className="tree-item tree-item-indent-2"
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => { e.stopPropagation(); handleOpenProcedure(conn.id, proc) }}
                                            title="Click to open in new tab"
                                          >
                                            {proc.type === 'function'
                                              ? <FunctionSquare size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                                              : <Code2 size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                                            }
                                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {proc.name}
                                            </span>
                                            <span style={{
                                              fontSize: 9,
                                              color: 'var(--text-tertiary)',
                                              fontFamily: 'var(--font-mono)',
                                              flexShrink: 0
                                            }}>
                                              {proc.type === 'function' ? 'fn' : 'proc'}
                                            </span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
                    </div>
                  )
                })}
              </div>
            )
          })
        })()}

        {/* SQL Templates section */}
        <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: 8 }}>
          <div
            className="connection-item"
            onClick={() => setTemplatesExpanded((v) => !v)}
            style={{ padding: '8px 14px' }}
          >
            {templatesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Code2 size={13} style={{ color: 'var(--accent)' }} />
            <span className="connection-name" style={{ fontWeight: 600 }}>{t('sidebar.templates')}</span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {SQL_TEMPLATES.length}
            </span>
          </div>
          {templatesExpanded && (
            <div>
              {SQL_TEMPLATES.map((template) => (
                <div
                  key={template.id}
                  className="tree-item tree-item-indent-1"
                  title="Insert template into active tab"
                  onClick={() => applyTemplate(template.sql)}
                >
                  <Code2 size={11} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {template.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: 8 }}>
          <div
            className="connection-item"
            onClick={() => setSavedQueriesExpanded((v) => !v)}
            style={{ padding: '8px 14px' }}
          >
            {savedQueriesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <BookOpen size={13} style={{ color: 'var(--accent)' }} />
            <span className="connection-name" style={{ fontWeight: 600 }}>{t('sidebar.savedQueries')}</span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {savedQueries.length}
            </span>
          </div>
          {savedQueriesExpanded && (
            <div>
              {savedQueries.length === 0 ? (
                <div style={{ padding: '6px 28px', fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                  {t('sidebar.noSavedQueries')}
                </div>
              ) : (
                (() => {
                  const grouped: Record<string, SavedQuery[]> = {}
                  for (const q of savedQueries) {
                    const cat = normalizeCategoryKey(q.category)
                    if (!grouped[cat]) grouped[cat] = []
                    grouped[cat].push(q)
                  }
                  const categories = Object.keys(grouped).sort((a, b) => {
                    if (isUngroupedCategory(a)) return 1
                    if (isUngroupedCategory(b)) return -1
                    return a.localeCompare(b)
                  })
                  const hasManyCategories =
                    categories.length > 1 ||
                    (categories.length === 1 && !isUngroupedCategory(categories[0]))

                  return categories.map((cat) => {
                    const catQueries = grouped[cat]
                    const isCatExpanded = expandedQueryCategories.has(cat)
                    const toggleCat = () =>
                      setExpandedQueryCategories((prev) => {
                        const next = new Set(prev)
                        if (next.has(cat)) next.delete(cat)
                        else next.add(cat)
                        return next
                      })

                    return (
                      <div key={cat}>
                        {hasManyCategories && !isUngroupedCategory(cat) && (
                          <button
                            type="button"
                            className="tree-item tree-item-indent-1"
                            style={{
                              fontWeight: 600,
                              fontSize: 10,
                              color: 'var(--text-tertiary)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              cursor: 'pointer',
                              userSelect: 'none',
                              width: '100%',
                              border: 'none',
                              background: 'transparent',
                              textAlign: 'left'
                            }}
                            onClick={toggleCat}
                            aria-expanded={isCatExpanded}
                          >
                            {isCatExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <Folder size={10} style={{ opacity: 0.7 }} />
                            <span>{cat}</span>
                          </button>
                        )}
                        {(isUngroupedCategory(cat) || !hasManyCategories || isCatExpanded) &&
                          catQueries.map((q) => (
                            <div
                              key={q.id}
                              className="tree-item tree-item-indent-1"
                              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                              onClick={() => renamingQueryId !== q.id && openSavedQuery(q)}
                            >
                              <Code2 size={11} style={{ flexShrink: 0 }} />
                              {renamingQueryId === q.id ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  disabled={isRenameSubmitting}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      void commitRename(q)
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault()
                                      cancelRename()
                                    }
                                  }}
                                  onBlur={(e) => {
                                    const nextFocused = e.relatedTarget
                                    if (
                                      nextFocused instanceof Node &&
                                      e.currentTarget.parentElement?.contains(nextFocused)
                                    ) {
                                      return
                                    }
                                    void commitRename(q)
                                  }}
                                  style={{
                                    flex: 1,
                                    fontSize: 'var(--font-size-xs)',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--accent)',
                                    borderRadius: 3,
                                    padding: '1px 4px',
                                    color: 'var(--text-primary)',
                                    outline: 'none'
                                  }}
                                />
                              ) : (
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {q.name}
                                </span>
                              )}
                              <button
                                className="icon-btn"
                                style={{ width: 20, height: 20, flexShrink: 0 }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (renamingQueryId === q.id) {
                                    void commitRename(q)
                                  } else {
                                    setRenamingQueryId(q.id)
                                    setRenameValue(q.name)
                                  }
                                }}
                                title={renamingQueryId === q.id ? 'Save name' : 'Rename'}
                                disabled={isRenameSubmitting}
                              >
                                {renamingQueryId === q.id ? <Check size={10} /> : <Pencil size={10} />}
                              </button>
                              <button
                                className="icon-btn"
                                style={{ width: 20, height: 20, flexShrink: 0 }}
                                onClick={(e) => { e.stopPropagation(); deleteSavedQuery(q.id) }}
                                title="Delete"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          ))}
                      </div>
                    )
                  })
                })()
              )}
            </div>
          )}
        </div>
      </div>

      {copyTableState && (
        <CopyTableModal
          connectionId={copyTableState.connectionId}
          connectionName={copyTableState.connectionName}
          databaseType={copyTableState.databaseType}
          sourceTable={copyTableState.sourceTable}
          sourceDatabase={copyTableState.sourceDatabase}
          sourceSchema={copyTableState.sourceSchema}
          onClose={() => setCopyTableState(null)}
          onCopied={(targetTable) => {
            void handleCopyTableSuccess(targetTable)
          }}
        />
      )}
    </div>
  )
}
