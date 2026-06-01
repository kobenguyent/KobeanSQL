import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type ColumnFiltersState,
  type ColumnSizingState
} from '@tanstack/react-table'
import { ArrowUp, ArrowDown, Download, Filter, Maximize2, RefreshCw, Edit2, Check, X, Trash2, Copy } from 'lucide-react'
import type { QueryResult, ColumnInfo, DatabaseType } from '../../types'
import { useAppStore } from '../../store'

interface Props {
  result: QueryResult
  connectionId?: string | null
  tableName?: string
  database?: string
  schema?: string
  onRefresh?: () => void
}

function cellClass(value: unknown): string {
  if (value === null || value === undefined) return 'null-value'
  if (typeof value === 'number' || typeof value === 'bigint') return 'number-value'
  if (typeof value === 'boolean') return 'bool-value'
  return ''
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function quoteIdentifierForDb(name: string, dbType?: DatabaseType): string {
  switch (dbType) {
    case 'mssql': return `[${name.replace(/]/g, ']]')}]`
    case 'mysql':
    case 'mariadb': return `\`${name.replace(/`/g, '``')}\``
    default: return `"${name.replace(/"/g, '""')}"`
  }
}

export function quoteValueForDb(val: unknown, dbType?: DatabaseType): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number' || typeof val === 'bigint') return String(val)
  if (typeof val === 'boolean') {
    if (dbType === 'mssql') return val ? '1' : '0'
    return val ? 'TRUE' : 'FALSE'
  }
  // Escape literals by dialect
  const escaped = String(val).replace(/'/g, "''")
  const str = dbType === 'mysql' || dbType === 'mariadb'
    ? escaped.replace(/\\/g, '\\\\')
    : escaped
  return `'${str}'`
}

export function buildInlineUpdateSql(
  row: Record<string, unknown>,
  col: string,
  newVal: unknown,
  pkColumns: ColumnInfo[],
  tableName: string,
  database?: string,
  schema?: string,
  dbType?: DatabaseType
): string | null {
  if (pkColumns.length === 0) return null
  const q = (name: string) => quoteIdentifierForDb(name, dbType)
  const v = (value: unknown) => quoteValueForDb(value, dbType)
  // Prefer explicit schema when present; otherwise fall back to database qualifier.
  const qualifier = schema ?? database
  const tableRef = qualifier ? `${q(qualifier)}.${q(tableName)}` : q(tableName)
  const setCl = `${q(col)} = ${v(newVal)}`
  const whereCl = pkColumns.map((pk) => `${q(pk.name)} = ${v(row[pk.name])}`).join(' AND ')
  return `UPDATE ${tableRef}\nSET ${setCl}\nWHERE ${whereCl};`
}

export function buildDeleteSql(
  row: Record<string, unknown>,
  pkColumns: ColumnInfo[],
  tableName: string,
  database?: string,
  schema?: string,
  dbType?: DatabaseType
): string | null {
  if (pkColumns.length === 0) return null
  const q = (name: string) => quoteIdentifierForDb(name, dbType)
  const v = (value: unknown) => quoteValueForDb(value, dbType)
  const qualifier = schema ?? database
  const tableRef = qualifier ? `${q(qualifier)}.${q(tableName)}` : q(tableName)
  const whereCl = pkColumns.map((pk) => `${q(pk.name)} = ${v(row[pk.name])}`).join(' AND ')
  return `DELETE FROM ${tableRef}\nWHERE ${whereCl};`
}

function isLikelyObjectId(value: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(value)
}

/**
 * For ObjectId-looking values we emit a dual filter to match both string-based
 * and ObjectId-based `_id` documents.
 */
export function buildMongoPkFilter(row: Record<string, unknown>, pkColumns: ColumnInfo[]): Record<string, unknown> | null {
  if (!pkColumns.some((pk) => pk.name === '_id')) return null
  const idValue = row._id
  if (idValue === undefined) return null

  if (typeof idValue === 'string' && isLikelyObjectId(idValue)) {
    return {
      $or: [{ _id: idValue }, { _id: { $oid: idValue } }]
    }
  }
  return { _id: idValue }
}

export function buildInlineUpdateMongoQuery(
  row: Record<string, unknown>,
  col: string,
  newVal: unknown,
  pkColumns: ColumnInfo[],
  collectionName: string
): string | null {
  const filter = buildMongoPkFilter(row, pkColumns)
  if (!filter) return null
  const safeCollectionName = JSON.stringify(collectionName)
  const update = { $set: { [col]: newVal } }
  return `db.getCollection(${safeCollectionName}).updateOne(${JSON.stringify(filter)},${JSON.stringify(update)})`
}

export function buildDeleteMongoQuery(
  row: Record<string, unknown>,
  pkColumns: ColumnInfo[],
  collectionName: string
): string | null {
  const filter = buildMongoPkFilter(row, pkColumns)
  if (!filter) return null
  const safeCollectionName = JSON.stringify(collectionName)
  return `db.getCollection(${safeCollectionName}).deleteOne(${JSON.stringify(filter)})`
}

export function getVisibleRowSelectionRange(
  rows: Array<{ index: number }>,
  anchorRowIdx: number,
  targetRowIdx: number
): number[] {
  const orderedIndexes = rows.map((row) => row.index)
  const anchorPos = orderedIndexes.indexOf(anchorRowIdx)
  const targetPos = orderedIndexes.indexOf(targetRowIdx)

  if (targetPos === -1) return []
  if (anchorPos === -1) return [targetRowIdx]

  const [start, end] = anchorPos < targetPos ? [anchorPos, targetPos] : [targetPos, anchorPos]
  return orderedIndexes.slice(start, end + 1)
}

export function getSelectedVisibleRows<T extends { index: number }>(
  rows: T[],
  selectedRows: Set<number>
): T[] {
  return rows.filter((row) => selectedRows.has(row.index))
}

const TRUNCATE_LEN = 100

/**
 * Long or multiline values should expose an explicit preview control so the
 * full cell content remains reachable even when the visible column is clipped.
 */
export function canPreviewCellValue(value: unknown): boolean {
  const str = formatCell(value)
  return str.length > TRUNCATE_LEN || str.includes('\n')
}

/** Cell value display — truncated with expand-on-click */
function CellDisplay({
  value,
  onExpand
}: {
  value: unknown
  onExpand: (val: unknown) => void
}): React.JSX.Element {
  const str = formatCell(value)
  const isLong = canPreviewCellValue(value)
  const display = isLong ? str.slice(0, TRUNCATE_LEN).replace(/\n/g, '↵') + '…' : str
  if (!isLong) {
    return <span className={cellClass(value)}>{display}</span>
  }

  return (
    <span className="cell-display cell-display-expandable">
      <span
        className={`cell-display-text ${cellClass(value)}`}
        title="Click preview to view full value"
      >
        {display}
      </span>
      <button
        type="button"
        className="cell-display-preview-btn"
        title="Preview full value"
        aria-label="Preview full value"
        onClick={(e) => { e.stopPropagation(); onExpand(value) }}
      >
        <Maximize2 size={10} />
      </button>
    </span>
  )
}

/** Full-value viewer modal */
function CellViewerModal({
  value,
  onClose
}: {
  value: unknown
  onClose: () => void
}): React.JSX.Element {
  const str = formatCell(value)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copy = () => {
    navigator.clipboard.writeText(str).then(() => {
      setCopied(true)
      setCopyError(null)
      setTimeout(() => setCopied(false), 1500)
    }).catch((err: Error) => {
      setCopyError(err.message || 'Unable to copy to clipboard')
    })
  }
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <span className="modal-title">Cell Value</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '50vh',
              overflowY: 'auto',
              margin: 0
            }}
          >
            {str}
          </pre>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          {copyError && (
            <span style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>{copyError}</span>
          )}
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Inline-edit confirmation dialog */
function EditConfirmModal({
  sql,
  onConfirm,
  onCancel,
  error,
  isUpdating
}: {
  sql: string
  onConfirm: () => void
  onCancel: () => void
  error: string | null
  isUpdating: boolean
}): React.JSX.Element {
  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <span className="modal-title">Confirm Update</span>
          <button className="icon-btn" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            The following SQL will be executed. Please review before confirming.
          </p>
          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0
            }}
          >
            {sql}
          </pre>
          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
              <strong>Error:</strong> {error}
            </div>
          )}
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>
            ⚠ This operation directly modifies database data and cannot be undone automatically.
            Ensure your WHERE clause identifies the correct row(s).
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={isUpdating}>
            {isUpdating ? 'Executing…' : 'Execute Update'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Right-click context menu */
function ContextMenu({
  x,
  y,
  selectedCount,
  canDelete,
  onDelete,
  onCopy,
  onClose
}: {
  x: number
  y: number
  selectedCount: number
  canDelete: boolean
  onDelete: () => void
  onCopy: () => void
  onClose: () => void
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  // Reposition if the menu would overflow the viewport
  const style = useMemo(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const menuW = 220
    const menuH = 90
    return {
      left: x + menuW > vw ? x - menuW : x,
      top: y + menuH > vh ? y - menuH : y
    }
  }, [x, y])

  return createPortal(
    <div
      ref={menuRef}
      className="ctx-menu"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="ctx-menu-item"
        onClick={() => { onCopy(); onClose() }}
      >
        <Copy size={12} />
        <span>Copy Row Data{selectedCount > 1 ? ` (${selectedCount})` : ''}</span>
      </button>
      {canDelete && (
        <>
          <div className="ctx-menu-separator" />
          <button
            className="ctx-menu-item ctx-menu-item-danger"
            onClick={() => { onDelete(); onClose() }}
          >
            <Trash2 size={12} />
            <span>Delete Selected Row{selectedCount !== 1 ? 's' : ''} ({selectedCount})</span>
          </button>
        </>
      )}
    </div>,
    document.body
  )
}

/** Delete confirmation dialog */
function DeleteConfirmModal({
  sqls,
  rowCount,
  onConfirm,
  onCancel,
  error,
  isDeleting
}: {
  sqls: string[]
  rowCount: number
  onConfirm: () => void
  onCancel: () => void
  error: string | null
  isDeleting: boolean
}): React.JSX.Element {
  const preview = sqls.slice(0, 3).join('\n')
  const hasMore = sqls.length > 3
  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <span className="modal-title">Confirm Deletion</span>
          <button className="icon-btn" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            The following SQL will be executed to permanently delete{' '}
            <strong style={{ color: 'var(--color-error)' }}>{rowCount} row{rowCount !== 1 ? 's' : ''}</strong>.
            This action cannot be undone.
          </p>
          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0
            }}
          >
            {preview}{hasMore ? `\n… and ${sqls.length - 3} more statement${sqls.length - 3 !== 1 ? 's' : ''}` : ''}
          </pre>
          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
              <strong>Error:</strong> {error}
            </div>
          )}
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>
            ⚠ This operation directly deletes data from the database and cannot be automatically undone.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : `Delete ${rowCount} Row${rowCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function ResultsTable({
  result,
  connectionId,
  tableName,
  database,
  schema,
  onRefresh
}: Props): React.JSX.Element {
  const { connections } = useAppStore()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})
  const [showFilter, setShowFilter] = useState(false)

  // Cell viewer
  const [expandedValue, setExpandedValue] = useState<unknown>(null)
  const [showViewer, setShowViewer] = useState(false)

  // Inline editing state
  const [pkColumns, setPkColumns] = useState<ColumnInfo[]>([])
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; col: string; original: unknown } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [pendingUpdate, setPendingUpdate] = useState<{ sql: string; row: Record<string, unknown> } | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Row selection state (Feature 2)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [lastSelectedRow, setLastSelectedRow] = useState<number | null>(null)

  // Context menu state (Feature 2)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Delete confirmation state (Feature 2)
  const [pendingDelete, setPendingDelete] = useState<{ sqls: string[]; count: number } | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Transient inline error (auto-clears) for non-modal operation failures
  const [tableError, setTableError] = useState<string | null>(null)
  const tableErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showTableError(msg: string) {
    setTableError(msg)
    if (tableErrorTimer.current) clearTimeout(tableErrorTimer.current)
    tableErrorTimer.current = setTimeout(() => setTableError(null), 4000)
  }

  const conn = connectionId ? connections.find((c) => c.id === connectionId) : null
  const canEdit = !!(connectionId && tableName && conn)

  // Load PK columns when in table mode
  useEffect(() => {
    if (!canEdit || !connectionId || !tableName) return
    const qualifiedTableName = schema ? `${schema}.${tableName}` : tableName
    window.db.getColumns(connectionId, qualifiedTableName, database).then((cols) => {
      setPkColumns(cols.filter((c) => c.primaryKey))
    }).catch(() => setPkColumns([]))
  }, [canEdit, connectionId, tableName, database, schema])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingCell])

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  function buildUpdateSql(
    row: Record<string, unknown>,
    col: string,
    newVal: unknown
  ): string | null {
    if (conn?.type === 'mongodb') {
      return buildInlineUpdateMongoQuery(row, col, newVal, pkColumns, tableName!)
    }
    return buildInlineUpdateSql(
      row,
      col,
      newVal,
      pkColumns,
      tableName!,
      database,
      schema,
      conn?.type
    )
  }

  /**
   * Re-type the edited string value based on the original cell value's type so
   * quoteValueForDb emits the correct SQL literal (number, boolean, NULL, or string).
   */
  function coerceEditValue(editStr: string, original: unknown): unknown {
    const trimmed = editStr.trim()
    // Explicit NULL keyword (or empty string for a originally-null cell) → SQL NULL
    if (trimmed.toUpperCase() === 'NULL') return null
    if (trimmed === '' && (original === null || original === undefined)) return null
    if (original === null || original === undefined) return trimmed
    if (typeof original === 'boolean') {
      const lower = trimmed.toLowerCase()
      if (lower === 'true' || lower === '1') return true
      if (lower === 'false' || lower === '0') return false
      return trimmed
    }
    if (typeof original === 'number' || typeof original === 'bigint') {
      const n = Number(trimmed)
      if (!isNaN(n) && trimmed !== '') return n
      return trimmed
    }
    return editStr
  }

  /**
   * Returns true when the edit string differs from the original cell value's
   * string representation — used for both the dirty indicator and no-op commit check.
   */
  function isValueDirty(editStr: string, original: unknown): boolean {
    const originalStr = original === null || original === undefined ? '' : String(original)
    return editStr !== originalStr
  }

  function handleCellDoubleClick(rowIdx: number, col: string, value: unknown) {
    if (!canEdit) return
    // Previous edit is implicitly replaced without saving
    setEditingCell({ rowIdx, col, original: value })
    setEditValue(value === null || value === undefined ? '' : String(value))
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: Record<string, unknown>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit(row)
    } else if (e.key === 'Escape') {
      setEditingCell(null)
    }
  }

  function commitEdit(row: Record<string, unknown>) {
    if (!editingCell) return
    const typedVal = coerceEditValue(editValue, editingCell.original)
    // No-op if value string representation is unchanged
    if (!isValueDirty(editValue, editingCell.original)) {
      setEditingCell(null)
      return
    }
    const sql = buildUpdateSql(row, editingCell.col, typedVal)
    if (!sql) {
      setEditingCell(null)
      setUpdateError('Cannot edit: table has no primary key columns. Editing requires a primary key to safely identify the row.')
      return
    }
    setPendingUpdate({ sql, row })
    setUpdateError(null)
    setEditingCell(null)
  }

  async function executeUpdate() {
    if (!pendingUpdate || !connectionId || isUpdating) return
    setIsUpdating(true)
    setUpdateError(null)
    try {
      const res = await window.db.query(connectionId, pendingUpdate.sql)
      if (res.error) {
        setUpdateError(res.error)
        setIsUpdating(false)
        return
      }
      setPendingUpdate(null)
      setIsUpdating(false)
      onRefresh?.()
    } catch (err) {
      setUpdateError((err as Error).message)
      setIsUpdating(false)
    }
  }

  function buildDeleteSqlForRow(row: Record<string, unknown>): string | null {
    if (conn?.type === 'mongodb') {
      return buildDeleteMongoQuery(row, pkColumns, tableName!)
    }
    return buildDeleteSql(row, pkColumns, tableName!, database, schema, conn?.type)
  }

  function handleDeleteSelected(rows: { index: number; original: Record<string, unknown> }[]) {
    const sqls = getSelectedVisibleRows(rows, selectedRows)
      .map((r) => buildDeleteSqlForRow(r.original))
      .filter((s): s is string => s !== null)
    if (sqls.length === 0) {
      showTableError('Cannot delete: table has no primary key columns, which are required to safely identify rows for deletion.')
      return
    }
    setPendingDelete({ sqls, count: sqls.length })
  }

  async function executeDelete() {
    if (!pendingDelete || !connectionId || isDeleting) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      for (const sql of pendingDelete.sqls) {
        const res = await window.db.query(connectionId, sql)
        if (res.error) {
          setDeleteError(res.error)
          setIsDeleting(false)
          return
        }
      }
      setPendingDelete(null)
      setIsDeleting(false)
      setSelectedRows(new Set())
      onRefresh?.()
    } catch (err) {
      setDeleteError((err as Error).message)
      setIsDeleting(false)
    }
  }

  function copyRowsData(rows: { index: number; original: Record<string, unknown> }[]) {
    const selected = getSelectedVisibleRows(rows, selectedRows).map((r) => r.original)
    if (selected.length === 0) return
    const headers = result.columns.map((c) => c.name)
    const lines = selected.map((row) => headers.map((h) => formatCell(row[h])).join('\t'))
    const text = [headers.join('\t'), ...lines].join('\n')
    navigator.clipboard.writeText(text).catch((err: Error) => {
      showTableError(`Copy failed: ${err.message || 'clipboard unavailable'}`)
    })
  }

  const columns = useMemo(
    () =>
      result.columns.map((col) => ({
        id: col.name,
        accessorKey: col.name,
        header: col.name,
        size: 150,
        minSize: 60,
        maxSize: 1200,
        filterFn: 'includesString' as const,
        cell: (info: { getValue: () => unknown; row: { index: number; original: Record<string, unknown> } }) => {
          const v = info.getValue()
          const rowIdx = info.row.index
          const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.col === col.name
          const isDirty = isEditing && isValueDirty(editValue, editingCell?.original)
          if (isEditing) {
            return (
              <div className={`cell-edit-wrap${isDirty ? ' cell-dirty' : ''}`}>
                <input
                  ref={editInputRef}
                  className="cell-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => handleEditKeyDown(e, info.row.original)}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  className="cell-action-btn cell-action-save"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); commitEdit(info.row.original) }}
                  title="Save (Enter)"
                >
                  <Check size={10} />
                </button>
                <button
                  className="cell-action-btn cell-action-cancel"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); setEditingCell(null) }}
                  title="Cancel (Esc)"
                >
                  <X size={10} />
                </button>
              </div>
            )
          }
          return (
            <span
              onDoubleClick={canEdit ? () => handleCellDoubleClick(rowIdx, col.name, v) : undefined}
              style={canEdit ? { cursor: 'text', display: 'block' } : undefined}
              title={canEdit ? 'Double-click to edit' : undefined}
            >
              <CellDisplay value={v} onExpand={(val) => { setExpandedValue(val); setShowViewer(true) }} />
            </span>
          )
        }
      })),
    [result.columns, editingCell, editValue, canEdit, pkColumns, schema, database, tableName, conn?.type]
  )

  const table = useReactTable({
    data: result.rows,
    columns,
    state: { sorting, columnFilters, columnSizing },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  })

  const exportCSV = () => {
    const headers = result.columns.map((c) => c.name).join(',')
    const rows = result.rows.map((row) =>
      result.columns
        .map((c) => {
          const val = row[c.name]
          const str = formatCell(val)
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
        })
        .join(',')
    )
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query_result_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleFilter = () => {
    setShowFilter((prev) => !prev)
    if (showFilter) setColumnFilters([])
  }

  const filteredCount = table.getFilteredRowModel().rows.length
  const isSingleRow = result.rows.length === 1
  const filteredRows = table.getRowModel().rows
  const selectedVisibleRows = useMemo(() => getSelectedVisibleRows(filteredRows, selectedRows), [filteredRows, selectedRows])
  const selCount = selectedVisibleRows.length

  // ── Row Selection (Feature 2) ─────────────────────────────────
  const handleRowClick = useCallback((e: React.MouseEvent, rowIdx: number) => {
    // Don't interfere with cell editing or cell expansion clicks
    if ((e.target as HTMLElement).closest('.cell-edit-wrap, .cell-edit-input')) return
    if (e.shiftKey && lastSelectedRow !== null) {
      const range = getVisibleRowSelectionRange(filteredRows, lastSelectedRow, rowIdx)
      setSelectedRows((prev) => {
        const next = new Set(prev)
        range.forEach((idx) => next.add(idx))
        return next
      })
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev)
        if (next.has(rowIdx)) next.delete(rowIdx)
        else next.add(rowIdx)
        return next
      })
      setLastSelectedRow(rowIdx)
    } else {
      setSelectedRows(new Set([rowIdx]))
      setLastSelectedRow(rowIdx)
    }
  }, [filteredRows, lastSelectedRow])

  const handleContextMenu = useCallback((e: React.MouseEvent, rowIdx: number) => {
    e.preventDefault()
    // If right-clicked row is not already selected, select it exclusively
    if (!selectedRows.has(rowIdx)) {
      setSelectedRows(new Set([rowIdx]))
      setLastSelectedRow(rowIdx)
    }
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [selectedRows])

  if (result.error) {
    return (
      <div className="results-pane" style={{ minHeight: 80 }}>
        <div className="error-message">
          <strong>Error:</strong> {result.error}
        </div>
      </div>
    )
  }

  return (
    <div className="results-pane" style={{ height: '100%' }}>
      <div className="results-header">
        <span className="results-meta">
          {filteredCount !== result.rowCount
            ? `${filteredCount} / ${result.rowCount} rows`
            : `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''}`}
          {' · '}
          {result.duration}ms
          {' · '}
          {result.columns.length} col{result.columns.length !== 1 ? 's' : ''}
          {isSingleRow && (
            <span style={{ marginLeft: 6, color: 'var(--accent)', fontSize: 'var(--font-size-xs)' }}>
              · horizontal view
            </span>
          )}
          {canEdit && !selCount && (
            <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
              · <Edit2 size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> double-click to edit
            </span>
          )}
        </span>

        {/* Inline operation error (auto-clears) */}
        {tableError && (
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-error)',
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 20,
              padding: '2px 10px',
              whiteSpace: 'nowrap',
              flexShrink: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 280
            }}
            title={tableError}
          >
            ⚠ {tableError}
          </span>
        )}

        {/* Selection count + bulk actions */}
        {selCount > 0 && (
          <span className="selection-badge">
            {selCount} selected
            {canEdit && (
              <button
                className="icon-btn icon-btn-danger"
                style={{ marginLeft: 6 }}
                title={`Delete ${selCount} row${selCount !== 1 ? 's' : ''}`}
                onClick={() => handleDeleteSelected(filteredRows)}
              >
                <Trash2 size={11} />
              </button>
            )}
            <button
              className="icon-btn"
              style={{ marginLeft: 2 }}
              title="Copy row data"
              onClick={() => copyRowsData(filteredRows)}
            >
              <Copy size={11} />
            </button>
            <button
              className="icon-btn"
              style={{ marginLeft: 2 }}
              title="Clear selection"
              onClick={() => setSelectedRows(new Set())}
            >
              <X size={11} />
            </button>
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          {onRefresh && (
            <button
              className="icon-btn"
              onClick={onRefresh}
              data-tooltip="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          )}
          {!isSingleRow && (
            <button
              className={`icon-btn ${showFilter ? 'active' : ''}`}
              onClick={toggleFilter}
              data-tooltip="Filter columns"
            >
              <Filter size={13} />
            </button>
          )}
          <button className="icon-btn" onClick={exportCSV} data-tooltip="Export CSV">
            <Download size={13} />
          </button>
        </div>
      </div>

      <div className="results-table-wrap">
        {result.rows.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px', height: 80 }}>
            <span className="empty-state-title" style={{ fontSize: 'var(--font-size-sm)' }}>
              Query executed successfully — no rows returned
            </span>
          </div>
        ) : isSingleRow ? (
          /* Horizontal view for single-row results */
          <table className="data-table">
            <tbody>
              {result.columns.map((col) => {
                const value = result.rows[0][col.name]
                return (
                  <tr key={col.name}>
                    <td style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 600,
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      whiteSpace: 'nowrap',
                      width: 160,
                      borderRight: '1px solid var(--glass-border)',
                      userSelect: 'none'
                    }}>
                      {col.name}
                    </td>
                    <td className={cellClass(value)}>
                      <CellDisplay value={value} onExpand={(val) => { setExpandedValue(val); setShowViewer(true) }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="data-table" style={{ width: table.getTotalSize() + 50 }}>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  <th className="row-num-th">
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      title="Select all visible rows"
                      checked={filteredRows.length > 0 && selectedVisibleRows.length === filteredRows.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRows(new Set(filteredRows.map((r) => r.index)))
                        } else {
                          setSelectedRows(new Set())
                        }
                      }}
                    />
                  </th>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{ width: header.getSize(), minWidth: header.column.columnDef.minSize }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span className="sort-indicator">
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp size={10} />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown size={10} />
                        ) : null}
                      </span>
                      <div
                        className={`column-resize-handle${header.column.getIsResizing() ? ' is-resizing' : ''}`}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  ))}
                </tr>
              ))}
              {showFilter && (
                <tr className="filter-row">
                  <th style={{ width: 50, minWidth: 50 }} />
                  {table.getHeaderGroups()[0]?.headers.map((header) => (
                    <th key={header.id} style={{ padding: '2px 4px', width: header.getSize() }}>
                      <input
                        className="column-filter-input"
                        type="text"
                        value={(header.column.getFilterValue() as string) ?? ''}
                        onChange={(e) => header.column.setFilterValue(e.target.value || undefined)}
                        placeholder={`Filter ${header.column.id}…`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => {
                const isSelected = selectedRows.has(row.index)
                return (
                  <tr
                    key={row.id}
                    className={isSelected ? 'row-selected' : undefined}
                    onClick={(e) => handleRowClick(e, row.index)}
                    onContextMenu={(e) => handleContextMenu(e, row.index)}
                  >
                    <td className="row-num-td" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="row-checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation()
                          setSelectedRows((prev) => {
                            const next = new Set(prev)
                            if (next.has(row.index)) next.delete(row.index)
                            else next.add(row.index)
                            return next
                          })
                          setLastSelectedRow(row.index)
                        }}
                      />
                      <span className="row-num-label">{idx + 1}</span>
                    </td>
                    {row.getVisibleCells().map((cell) => {
                      const isEditingCell = editingCell?.rowIdx === row.index && editingCell?.col === cell.column.id
                      const isDirtyCell = isEditingCell && isValueDirty(editValue, editingCell?.original)
                      return (
                        <td key={cell.id} className={isDirtyCell ? 'td-editing' : undefined}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Cell value viewer modal */}
      {showViewer && (
        <CellViewerModal
          value={expandedValue}
          onClose={() => setShowViewer(false)}
        />
      )}

      {/* Update confirmation modal */}
      {pendingUpdate && (
        <EditConfirmModal
          sql={pendingUpdate.sql}
          onConfirm={executeUpdate}
          onCancel={() => { setPendingUpdate(null); setUpdateError(null) }}
          error={updateError}
          isUpdating={isUpdating}
        />
      )}

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <DeleteConfirmModal
          sqls={pendingDelete.sqls}
          rowCount={pendingDelete.count}
          onConfirm={executeDelete}
          onCancel={() => { setPendingDelete(null); setDeleteError(null) }}
          error={deleteError}
          isDeleting={isDeleting}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selCount}
          canDelete={canEdit && pkColumns.length > 0}
          onDelete={() => handleDeleteSelected(filteredRows)}
          onCopy={() => copyRowsData(filteredRows)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
