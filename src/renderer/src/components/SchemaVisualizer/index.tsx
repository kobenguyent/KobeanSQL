import React, { useCallback, useEffect, useState } from 'react'
import { X, LayoutGrid, Focus, RefreshCw, Loader } from 'lucide-react'
import { SchemaCanvas } from './SchemaCanvas'
import type { DatabaseSchema, SchemaViewMode } from '@renderer/types/schema'

interface Props {
  connectionId: string
  connectionName: string
  database?: string
  onClose: () => void
}

export function SchemaVisualizer({ connectionId, connectionName, database, onClose }: Props) {
  const [schema, setSchema] = useState<DatabaseSchema | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<SchemaViewMode>('GLOBAL_MODE')
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>(undefined)

  const fetchSchema = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.db.getSchema(connectionId, database)
      setSchema(result)
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load schema')
    } finally {
      setLoading(false)
    }
  }, [connectionId, database])

  useEffect(() => {
    fetchSchema()
  }, [fetchSchema])

  const handleToggleMode = () => {
    if (mode === 'GLOBAL_MODE') {
      setMode('FOCUSED_MODE')
      if (!selectedTableId && schema?.tables.length) {
        setSelectedTableId(schema.tables[0].id)
      }
    } else {
      setMode('GLOBAL_MODE')
    }
  }

  return (
    <div className="schema-visualizer-overlay" onClick={onClose}>
      <div
        className="schema-visualizer-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header toolbar */}
        <div className="schema-visualizer-toolbar">
          <div className="schema-visualizer-title">
            <span className="schema-visualizer-title-text">Schema Visualizer</span>
            <span className="schema-visualizer-connection">{connectionName}{database ? ` · ${database}` : ''}</span>
          </div>

          <div className="schema-visualizer-actions">
            {/* Mode toggle */}
            <button
              className={`schema-mode-btn${mode === 'FOCUSED_MODE' ? ' active' : ''}`}
              onClick={handleToggleMode}
              title={mode === 'GLOBAL_MODE' ? 'Switch to Focused Mode' : 'Switch to Global Mode'}
              disabled={loading}
            >
              {mode === 'GLOBAL_MODE' ? <Focus size={14} /> : <LayoutGrid size={14} />}
              <span>{mode === 'GLOBAL_MODE' ? 'Focus' : 'Global'}</span>
            </button>

            {/* Focused mode: table selector */}
            {mode === 'FOCUSED_MODE' && schema && (
              <select
                className="schema-table-select"
                value={selectedTableId ?? ''}
                onChange={(e) => setSelectedTableId(e.target.value)}
              >
                {schema.tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}

            <button
              className="icon-btn"
              onClick={fetchSchema}
              title="Refresh schema"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>

            <button className="icon-btn" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Canvas area */}
        <div className="schema-visualizer-canvas">
          {loading && (
            <div className="schema-loading">
              <Loader size={20} className="spin" />
              <span>Loading schema…</span>
            </div>
          )}
          {error && !loading && (
            <div className="schema-error">
              <span>{error}</span>
              <button className="btn btn-secondary" onClick={fetchSchema}>Retry</button>
            </div>
          )}
          {!loading && !error && schema && (
            <SchemaCanvas
              schema={schema}
              mode={mode}
              selectedTableId={selectedTableId}
            />
          )}
          {!loading && !error && schema && schema.tables.length === 0 && (
            <div className="schema-empty">No tables found in this database.</div>
          )}
        </div>

        {/* Footer stats */}
        {schema && !loading && (
          <div className="schema-visualizer-footer">
            <div className="schema-stats">
              <span>{schema.tables.length} table{schema.tables.length !== 1 ? 's' : ''}</span>
              <span>{schema.relationships.length} relationship{schema.relationships.length !== 1 ? 's' : ''}</span>
            </div>
            {schema.truncated && (
              <div className="schema-warning" title="Large database detected. Only the first 200 tables are shown for performance.">
                Showing first 200 tables only
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
