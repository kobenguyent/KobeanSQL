import React, { useState } from 'react'
import { Trash2, ExternalLink, CheckCircle, XCircle, Clock } from 'lucide-react'
import { useAppStore } from '../../store'
import type { QueryHistoryEntry } from '../../types'
import {createPortal} from "react-dom";

interface Props {
  onClose: () => void
}

function asSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeHistoryEntry(entry: unknown, index: number): QueryHistoryEntry {
  const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
  const now = Date.now()
  return {
    id: asSafeString(record.id) || `history-ui-${now}-${index}`,
    sql: asSafeString(record.sql),
    connectionId: record.connectionId == null ? null : asSafeString(record.connectionId),
    connectionName: asSafeString(record.connectionName) || 'Unknown connection',
    timestamp: asSafeNumber(record.timestamp, now),
    duration: asSafeNumber(record.duration, 0),
    rowCount: asSafeNumber(record.rowCount, 0),
    error: asSafeString(record.error) || undefined
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString()
}

const SQL_PREVIEW_LEN = 120

function truncateSql(sql: string, maxLen = SQL_PREVIEW_LEN): string {
  const single = sql.replace(/\s+/g, ' ').trim()
  return single.length > maxLen ? single.slice(0, maxLen) + '…' : single
}

function asSafeString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

export function QueryHistoryPanel({ onClose }: Props): React.JSX.Element {
  const { queryHistory, clearHistory, openHistoryEntry } = useAppStore()
  const [filter, setFilter] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<QueryHistoryEntry | null>(null)
  const entries = queryHistory.map((entry, index) => normalizeHistoryEntry(entry, index))

  const filtered = filter.trim()
    ? entries.filter((e) =>
        asSafeString(e.sql).toLowerCase().includes(filter.toLowerCase()) ||
        asSafeString(e.connectionName).toLowerCase().includes(filter.toLowerCase())
      )
    : entries

  const handleOpen = (entry: QueryHistoryEntry) => {
    openHistoryEntry(entry)
    onClose()
  }

  const content = (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 680, width: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <span className="modal-title">Query History</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {entries.length > 0 && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={clearHistory}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Trash2 size={11} /> Clear
              </button>
            )}
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--glass-border)' }}>
          <input
            className="form-input"
            placeholder="Filter by SQL or connection…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
              {entries.length === 0 ? 'No queries executed yet' : 'No matches found'}
            </div>
          ) : (
            filtered.map((entry) => (
              <div
                key={entry.id}
                onClick={() => setSelectedEntry(selectedEntry?.id === entry.id ? null : entry)}
                style={{
                  padding: '8px 20px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--glass-border)',
                  background: selectedEntry?.id === entry.id ? 'var(--accent-dim)' : 'transparent',
                  transition: 'background var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  if (selectedEntry?.id !== entry.id)
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (selectedEntry?.id !== entry.id)
                    (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  {entry.error ? (
                    <XCircle size={12} color="var(--color-error)" />
                  ) : (
                    <CheckCircle size={12} color="var(--color-success)" />
                  )}
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
                  </span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)', marginLeft: 'auto' }}>
                    {asSafeString(entry.connectionName)}
                  </span>
                  {!entry.error && (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                      {entry.rowCount} row{entry.rowCount !== 1 ? 's' : ''} · {entry.duration}ms
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--font-size-xs)',
                    color: entry.error ? 'var(--color-error)' : 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {truncateSql(asSafeString(entry.sql))}
                </div>
                {selectedEntry?.id === entry.id && (
                  <div style={{ marginTop: 8 }}>
                    <pre
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-primary)',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 10px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 160,
                        overflowY: 'auto',
                        margin: 0
                      }}
                    >
                      {asSafeString(entry.sql)}
                    </pre>
                    {entry.error && (
                      <div style={{ marginTop: 6, color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>
                        Error: {entry.error}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={(e) => { e.stopPropagation(); handleOpen(entry) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <ExternalLink size={11} /> Open in Tab
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {filtered.length > 0 && (
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--glass-border)', fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
            <Clock size={10} style={{ display: 'inline', marginRight: 4 }} />
            {filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}
            {filter && ` matching "${filter}"`}
          </div>
        )}
      </div>
    </div>
  )

  const portalTarget =
    typeof document !== 'undefined'
      ? document.body ?? document.getElementById('root')
      : null

  return portalTarget ? createPortal(content, portalTarget) : content
}
