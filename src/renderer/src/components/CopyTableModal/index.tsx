import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CopyTableMode, CopyTableRequest, CopyTableResult, DatabaseType } from '../../../../preload'
import { useThemeClass } from '../../hooks/useThemeClass'

interface Props {
  connectionId: string
  connectionName: string
  databaseType: DatabaseType
  sourceTable: string
  sourceDatabase?: string
  sourceSchema?: string
  onClose: () => void
  onCopied?: (targetTable: string, result: CopyTableResult) => void
}

function normalizeCopyTargetPart(value?: string): string {
  return value?.trim().toLowerCase() || ''
}

function isSameTargetAsSource(payload: CopyTableRequest): boolean {
  return (
    normalizeCopyTargetPart(payload.sourceTable) === normalizeCopyTargetPart(payload.targetTable) &&
    normalizeCopyTargetPart(payload.sourceSchema ?? payload.sourceDatabase) ===
      normalizeCopyTargetPart(payload.targetSchema ?? payload.targetDatabase)
  )
}

export function CopyTableModal({
  connectionId,
  connectionName,
  databaseType,
  sourceTable,
  sourceDatabase,
  sourceSchema,
  onClose,
  onCopied
}: Props): React.JSX.Element {
  const themeClass = useThemeClass()
  const [targetTable, setTargetTable] = useState(`${sourceTable}_copy`)
  const [targetSchema, setTargetSchema] = useState(sourceSchema ?? '')
  const [mode, setMode] = useState<Extract<CopyTableMode, 'schema-only' | 'schema-and-data'>>('schema-and-data')
  const [preview, setPreview] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)

  const payload = useMemo<CopyTableRequest>(() => ({
    connectionId,
    databaseType,
    sourceTable,
    sourceDatabase,
    sourceSchema,
    targetTable: targetTable.trim(),
    targetDatabase: sourceDatabase,
    targetSchema: targetSchema.trim() || undefined,
    mode
  }), [connectionId, databaseType, sourceTable, sourceDatabase, sourceSchema, targetSchema, targetTable, mode])

  async function loadPreview(nextPayload: CopyTableRequest): Promise<void> {
    if (!nextPayload.targetTable) {
      setPreview([])
      setError('Target table name is required.')
      return
    }

    if (isSameTargetAsSource(nextPayload)) {
      setPreview([])
      setError('Source and target table must be different.')
      return
    }

    setIsPreviewLoading(true)
    setError(null)
    try {
      const result = await window.db.copyTablePreview(nextPayload)
      if (!result.success) {
        setPreview(result.statements)
        setError(result.error || 'Unable to build copy-table preview.')
        return
      }

      setPreview(result.statements)
    } catch (copyError) {
      setPreview([])
      setError(copyError instanceof Error ? copyError.message : 'Unable to build copy-table preview.')
    } finally {
      setIsPreviewLoading(false)
    }
  }

  useEffect(() => {
    void loadPreview(payload)
  }, [payload])

  async function handleExecute(): Promise<void> {
    if (!payload.targetTable) {
      setError('Target table name is required.')
      return
    }

    if (isSameTargetAsSource(payload)) {
      setError('Source and target table must be different.')
      return
    }

    setIsExecuting(true)
    setError(null)
    try {
      const result = await window.db.copyTableExecute(payload)
      if (!result.success) {
        setPreview(result.statements)
        setError(result.error || 'Copy table failed.')
        return
      }

      onCopied?.(payload.targetTable, result)
      onClose()
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Copy table failed.')
    } finally {
      setIsExecuting(false)
    }
  }

  return createPortal(
    <div className={`modal-overlay ${themeClass}`} onClick={onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <span className="modal-title">Copy Table Preview</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Copy <strong>{sourceTable}</strong> on <strong>{connectionName}</strong> using a same-connection preview-first flow.
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Target table name</span>
            <input
              className="input"
              value={targetTable}
              onChange={(event) => setTargetTable(event.target.value)}
              placeholder={`${sourceTable}_copy`}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Target schema</span>
            <input
              className="input"
              value={targetSchema}
              onChange={(event) => setTargetSchema(event.target.value)}
              placeholder={sourceSchema || 'Optional'}
            />
          </label>

          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Copy mode</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                name="copy-table-mode"
                value="schema-only"
                checked={mode === 'schema-only'}
                onChange={() => setMode('schema-only')}
              />
              <span>Schema only</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                name="copy-table-mode"
                value="schema-and-data"
                checked={mode === 'schema-and-data'}
                onChange={() => setMode('schema-and-data')}
              />
              <span>Schema and data</span>
            </label>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Preview statements</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void loadPreview(payload)}
                disabled={isPreviewLoading || isExecuting}
                type="button"
              >
                {isPreviewLoading ? 'Refreshing...' : 'Refresh Preview'}
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--glass-border)',
                background: 'rgba(0,0,0,0.18)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-xs)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                minHeight: 140,
                maxHeight: '40vh',
                overflowY: 'auto'
              }}
            >
              {preview.length > 0 ? preview.join('\n\n') : 'No preview available yet.'}
            </pre>
          </div>

          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isExecuting}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void handleExecute()}
            disabled={isPreviewLoading || isExecuting || preview.length === 0}
          >
            {isExecuting ? 'Copying...' : 'Execute Copy'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
