/**
 * MetricDashboard — drag-and-drop dashboard for database metrics and custom SQL queries.
 *
 * Architecture:
 *  - react-grid-layout provides the resizable/draggable grid.
 *  - recharts renders each widget's line/bar chart.
 *  - Metric widgets fetch data via window.db.getMetricData (Electron IPC).
 *  - SQL query widgets execute user-provided SQL via window.db.query (Electron IPC).
 *  - Dashboard layouts are saved to SQLite via window.db.saveDashboardLayout.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import GridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { X, Plus, Save, Trash2, RefreshCw, BarChart2, Play, AlertCircle } from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { ConnectionConfig } from '../../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WidgetType = 'metric' | 'sql-query'
export type ChartType = 'line' | 'bar'

export interface DashboardWidget {
  /** react-grid-layout key */
  i: string
  /** 'metric' (default) or 'sql-query' */
  widgetType?: WidgetType
  /** used when widgetType === 'metric' */
  metricId?: string
  title: string
  x: number
  y: number
  w: number
  h: number
  /** used when widgetType === 'sql-query' */
  connectionId?: string
  sqlQuery?: string
  /** column name to use for the X axis (defaults to first column) */
  xKey?: string
  /** column name to use for the Y axis (defaults to second column) */
  yKey?: string
  chartType?: ChartType
}

export interface DashboardLayoutRecord {
  id: string
  name: string
  widgetsJson: string
  updatedAt: number
}

interface MetricDataPoint {
  timestamp: number
  value: number
}

interface SqlDataPoint {
  [key: string]: unknown
}

interface Props {
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AVAILABLE_METRICS: Array<{ id: string; label: string; unit: string }> = [
  { id: 'active_connections', label: 'Active Connections', unit: '' },
  { id: 'queries_per_minute', label: 'Queries / Minute', unit: 'qpm' },
  { id: 'query_exec_time', label: 'Query Exec Time', unit: 'ms' },
  { id: 'row_counts', label: 'Row Count', unit: 'rows' },
]

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { i: 'w1', widgetType: 'metric', metricId: 'active_connections', title: 'Active Connections', x: 0, y: 0, w: 6, h: 4 },
  { i: 'w2', widgetType: 'metric', metricId: 'queries_per_minute', title: 'Queries Per Minute', x: 6, y: 0, w: 6, h: 4 },
]

const GRID_COLS = 12
const GRID_ROW_HEIGHT = 40

function genId(): string {
  return crypto.randomUUID()
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// MetricWidgetCard
// ---------------------------------------------------------------------------

interface MetricWidgetCardProps {
  widget: DashboardWidget
  data: MetricDataPoint[]
  loading: boolean
  onRemove: (id: string) => void
}

function MetricWidgetCard({ widget, data, loading, onRemove }: MetricWidgetCardProps): React.JSX.Element {
  const meta = AVAILABLE_METRICS.find((m) => m.id === widget.metricId)
  const unit = meta?.unit ?? ''

  const chartData = data.map((d) => ({
    time: formatTimestamp(d.timestamp),
    value: d.value,
  }))

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        backdropFilter: 'var(--glass-blur)',
      }}
    >
      {/* Widget header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--glass-border)',
          flexShrink: 0,
          cursor: 'move',
        }}
        className="dashboard-widget-drag-handle"
      >
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {widget.title}
        </span>
        <button
          className="icon-btn"
          style={{ width: 18, height: 18, flexShrink: 0 }}
          onClick={() => onRemove(widget.i)}
          title="Remove widget"
        >
          <X size={11} />
        </button>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, minHeight: 0, padding: '4px 4px 4px 0' }}>
        {loading ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--font-size-xs)',
            }}
          >
            Loading…
          </div>
        ) : chartData.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--font-size-xs)',
            }}
          >
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v: number) => (unit ? `${v}${unit}` : String(v))}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={(value: number) => [`${value}${unit ? ' ' + unit : ''}`, widget.title]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: 'var(--accent)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SqlQueryWidgetCard
// ---------------------------------------------------------------------------

interface SqlQueryWidgetCardProps {
  widget: DashboardWidget
  data: SqlDataPoint[]
  loading: boolean
  error: string | null
  onRemove: (id: string) => void
  onRerun: (id: string) => void
}

function resolveYKey(widget: DashboardWidget, data: SqlDataPoint[]): string {
  if (widget.yKey) return widget.yKey
  if (data.length === 0) return 'y'
  const keys = Object.keys(data[0])
  return keys[1] ?? keys[0] ?? 'y'
}

function SqlQueryWidgetCard({
  widget,
  data,
  loading,
  error,
  onRemove,
  onRerun,
}: SqlQueryWidgetCardProps): React.JSX.Element {
  const xKey = widget.xKey ?? (data.length > 0 ? Object.keys(data[0])[0] : 'x')
  const yKey = resolveYKey(widget, data)

  const chartData = data.map((row) => ({
    x: String(row[xKey] ?? ''),
    y: Number(row[yKey] ?? 0),
  }))

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        backdropFilter: 'var(--glass-blur)',
      }}
    >
      {/* Widget header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--glass-border)',
          flexShrink: 0,
          cursor: 'move',
        }}
        className="dashboard-widget-drag-handle"
      >
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {widget.title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button
            className="icon-btn"
            style={{ width: 18, height: 18 }}
            onClick={() => onRerun(widget.i)}
            title="Re-run query"
          >
            <Play size={10} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 18, height: 18 }}
            onClick={() => onRemove(widget.i)}
            title="Remove widget"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, minHeight: 0, padding: '4px 4px 4px 0' }}>
        {loading ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--font-size-xs)',
            }}
          >
            Running…
          </div>
        ) : error ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              color: 'var(--color-error)',
              fontSize: 'var(--font-size-xs)',
              padding: '0 8px',
              textAlign: 'center',
            }}
          >
            <AlertCircle size={16} />
            <span style={{ overflowWrap: 'anywhere' }}>{error}</span>
          </div>
        ) : chartData.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--font-size-xs)',
            }}
          >
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {widget.chartType === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="x"
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 11,
                    color: 'var(--text-primary)',
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                />
                <Bar dataKey="y" fill="var(--accent)" name={yKey} radius={[2, 2, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="x"
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 11,
                    color: 'var(--text-primary)',
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                />
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, fill: 'var(--accent)' }}
                  name={yKey}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AddWidgetModal
// ---------------------------------------------------------------------------

interface AddWidgetModalProps {
  onAddMetric: (metricId: string, title: string) => void
  onAddSqlQuery: (params: {
    connectionId: string
    sqlQuery: string
    title: string
    xKey: string
    yKey: string
    chartType: ChartType
  }) => void
  onCancel: () => void
  connections: ConnectionConfig[]
}

function AddWidgetModal({ onAddMetric, onAddSqlQuery, onCancel, connections }: AddWidgetModalProps): React.JSX.Element {
  const [widgetType, setWidgetType] = useState<WidgetType>('metric')
  // Metric fields
  const [metricId, setMetricId] = useState(AVAILABLE_METRICS[0].id)
  const [metricTitle, setMetricTitle] = useState(AVAILABLE_METRICS[0].label)
  // SQL query fields
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '')
  const [sqlQuery, setSqlQuery] = useState('')
  const [sqlTitle, setSqlTitle] = useState('SQL Query')
  const [xKey, setXKey] = useState('')
  const [yKey, setYKey] = useState('')
  const [chartType, setChartType] = useState<ChartType>('bar')

  // Sync connectionId once connections have loaded
  useEffect(() => {
    if (!connectionId && connections.length > 0) {
      setConnectionId(connections[0].id ?? '')
    }
  }, [connectionId, connections])

  const handleMetricChange = (id: string) => {
    setMetricId(id)
    const meta = AVAILABLE_METRICS.find((m) => m.id === id)
    if (meta) setMetricTitle(meta.label)
  }

  const handleAdd = () => {
    if (widgetType === 'metric') {
      if (metricTitle.trim()) onAddMetric(metricId, metricTitle.trim())
    } else {
      if (!connectionId || !sqlQuery.trim() || !sqlTitle.trim()) return
      onAddSqlQuery({
        connectionId,
        sqlQuery: sqlQuery.trim(),
        title: sqlTitle.trim(),
        xKey: xKey.trim(),
        yKey: yKey.trim(),
        chartType,
      })
    }
  }

  const isValid = widgetType === 'metric'
    ? metricTitle.trim().length > 0
    : connectionId.length > 0 && sqlQuery.trim().length > 0 && sqlTitle.trim().length > 0

  return (
    <div
      className="modal-overlay"
      onClick={onCancel}
      style={{ zIndex: 1400 }}
    >
      <div
        className="modal-panel"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Add Widget</span>
          <button className="icon-btn" onClick={onCancel}><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Type toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['metric', 'sql-query'] as WidgetType[]).map((t) => (
              <button
                key={t}
                className={widgetType === t ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ fontSize: 'var(--font-size-xs)', flex: 1 }}
                onClick={() => setWidgetType(t)}
              >
                {t === 'metric' ? 'Built-in Metric' : 'SQL Query'}
              </button>
            ))}
          </div>

          {widgetType === 'metric' ? (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Metric</span>
                <select
                  className="input-field"
                  value={metricId}
                  onChange={(e) => handleMetricChange(e.target.value)}
                >
                  {AVAILABLE_METRICS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Widget title</span>
                <input
                  className="input-field"
                  value={metricTitle}
                  onChange={(e) => setMetricTitle(e.target.value)}
                  placeholder="Widget title"
                />
              </label>
            </>
          ) : (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Connection</span>
                <select
                  className="input-field"
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                >
                  {connections.length === 0 ? (
                    <option value="">No connections available</option>
                  ) : (
                    connections.map((c) => (
                      <option key={c.id} value={c.id ?? ''}>{c.name}</option>
                    ))
                  )}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>SQL Query</span>
                <textarea
                  className="input-field"
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="SELECT column_x, column_y FROM my_table LIMIT 50"
                  rows={4}
                  style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>X-axis column (optional)</span>
                  <input
                    className="input-field"
                    value={xKey}
                    onChange={(e) => setXKey(e.target.value)}
                    placeholder="1st column"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Y-axis column (optional)</span>
                  <input
                    className="input-field"
                    value={yKey}
                    onChange={(e) => setYKey(e.target.value)}
                    placeholder="2nd column"
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Chart type</span>
                  <select
                    className="input-field"
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value as ChartType)}
                  >
                    <option value="bar">Bar</option>
                    <option value="line">Line</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Widget title</span>
                  <input
                    className="input-field"
                    value={sqlTitle}
                    onChange={(e) => setSqlTitle(e.target.value)}
                    placeholder="Widget title"
                  />
                </label>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={!isValid}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DashboardBuilder (main export)
// ---------------------------------------------------------------------------

export function DashboardBuilder({ onClose }: Props): React.JSX.Element {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(DEFAULT_WIDGETS)
  const [metricData, setMetricData] = useState<Record<string, MetricDataPoint[]>>({})
  const [loadingMetrics, setLoadingMetrics] = useState<Record<string, boolean>>({})
  // SQL query widget state keyed by widget id
  const [sqlData, setSqlData] = useState<Record<string, SqlDataPoint[]>>({})
  const [loadingSql, setLoadingSql] = useState<Record<string, boolean>>({})
  const [sqlErrors, setSqlErrors] = useState<Record<string, string | null>>({})
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [savedLayouts, setSavedLayouts] = useState<DashboardLayoutRecord[]>([])
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(null)
  const [layoutName, setLayoutName] = useState('My Dashboard')
  const [showAddWidget, setShowAddWidget] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState(900)
  // Keep a stable ref to the current widget list for use inside the polling interval
  const widgetsRef = useRef(widgets)
  useEffect(() => { widgetsRef.current = widgets }, [widgets])

  // ── Resize observer for grid container ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setGridWidth(entry.contentRect.width)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // ── Load saved layouts and connections on mount ──────────────────────────
  useEffect(() => {
    window.db.getDashboardLayouts().then((layouts) => {
      setSavedLayouts(layouts)
    }).catch((err) => { console.error('Failed to load dashboard layouts:', err) })
    window.db.getConnections().then(setConnections).catch(() => {/* not fatal */})
  }, [])

  // ── Run a single SQL query widget ────────────────────────────────────────
  const runSqlWidget = useCallback(async (widget: DashboardWidget) => {
    if (!widget.connectionId || !widget.sqlQuery) return
    setLoadingSql((prev) => ({ ...prev, [widget.i]: true }))
    setSqlErrors((prev) => ({ ...prev, [widget.i]: null }))
    try {
      const result = await window.db.query(widget.connectionId, widget.sqlQuery)
      if (result.error) {
        setSqlErrors((prev) => ({ ...prev, [widget.i]: result.error! }))
        setSqlData((prev) => ({ ...prev, [widget.i]: [] }))
      } else {
        setSqlData((prev) => ({ ...prev, [widget.i]: result.rows as SqlDataPoint[] }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSqlErrors((prev) => ({ ...prev, [widget.i]: msg }))
      setSqlData((prev) => ({ ...prev, [widget.i]: [] }))
    } finally {
      setLoadingSql((prev) => ({ ...prev, [widget.i]: false }))
    }
  }, [])

  // ── Fetch metric data for all metric widgets ──────────────────────────────
  const fetchAllMetrics = useCallback(async (currentWidgets: DashboardWidget[]) => {
    const metricWidgets = currentWidgets.filter((w) => (w.widgetType ?? 'metric') === 'metric')
    const uniqueMetricIds = [...new Set(metricWidgets.map((w) => w.metricId).filter(Boolean) as string[])]
    await Promise.all(
      uniqueMetricIds.map(async (metricId) => {
        setLoadingMetrics((prev) => ({ ...prev, [metricId]: true }))
        try {
          const result = await window.db.getMetricData(metricId, { points: 20 })
          setMetricData((prev) => ({ ...prev, [metricId]: result.data }))
        } catch (err) {
          console.error(`Failed to fetch metric data for ${metricId}:`, err)
        } finally {
          setLoadingMetrics((prev) => ({ ...prev, [metricId]: false }))
        }
      })
    )
  }, [])

  // ── Refresh all widgets ───────────────────────────────────────────────────
  const refreshAll = useCallback((currentWidgets: DashboardWidget[]) => {
    fetchAllMetrics(currentWidgets)
    currentWidgets
      .filter((w) => w.widgetType === 'sql-query')
      .forEach((w) => { runSqlWidget(w) })
  }, [fetchAllMetrics, runSqlWidget])

  useEffect(() => {
    refreshAll(widgets)
    const timer = window.setInterval(() => refreshAll(widgetsRef.current), 60_000)
    return () => window.clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAll])

  // Re-fetch when widget list changes (e.g. after adding/removing widgets)
  useEffect(() => {
    fetchAllMetrics(widgets)
  }, [widgets, fetchAllMetrics])

  // ── Grid layout change ───────────────────────────────────────────────────
  const handleLayoutChange = (layout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
    setWidgets((prev) =>
      prev.map((w) => {
        const updated = layout.find((l) => l.i === w.i)
        return updated ? { ...w, x: updated.x, y: updated.y, w: updated.w, h: updated.h } : w
      })
    )
  }

  // ── Add metric widget ────────────────────────────────────────────────────
  const handleAddMetricWidget = (metricId: string, title: string) => {
    const id = genId()
    const newWidget: DashboardWidget = {
      i: id,
      widgetType: 'metric',
      metricId,
      title,
      x: (widgets.length * 4) % GRID_COLS,
      y: Infinity,
      w: 6,
      h: 4,
    }
    setWidgets((prev) => [...prev, newWidget])
    setShowAddWidget(false)
    if (!metricData[metricId]) {
      window.db.getMetricData(metricId, { points: 20 })
        .then((result) => setMetricData((prev) => ({ ...prev, [metricId]: result.data })))
        .catch((err) => { console.error(`Failed to fetch metric data for ${metricId}:`, err) })
    }
  }

  // ── Add SQL query widget ─────────────────────────────────────────────────
  const handleAddSqlQueryWidget = (params: {
    connectionId: string
    sqlQuery: string
    title: string
    xKey: string
    yKey: string
    chartType: ChartType
  }) => {
    const id = genId()
    const newWidget: DashboardWidget = {
      i: id,
      widgetType: 'sql-query',
      title: params.title,
      connectionId: params.connectionId,
      sqlQuery: params.sqlQuery,
      xKey: params.xKey || undefined,
      yKey: params.yKey || undefined,
      chartType: params.chartType,
      x: (widgets.length * 4) % GRID_COLS,
      y: Infinity,
      w: 6,
      h: 4,
    }
    setWidgets((prev) => [...prev, newWidget])
    setShowAddWidget(false)
    runSqlWidget(newWidget)
  }

  // ── Remove widget ────────────────────────────────────────────────────────
  const handleRemoveWidget = (id: string) => {
    setWidgets((prev) => prev.filter((w) => w.i !== id))
  }

  // ── Save layout ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    setSaveStatus(null)
    try {
      const id = activeLayoutId ?? genId()
      const layout: DashboardLayoutRecord = {
        id,
        name: layoutName,
        widgetsJson: JSON.stringify(widgets),
        updatedAt: Date.now(),
      }
      await window.db.saveDashboardLayout(layout)
      setActiveLayoutId(id)
      setSavedLayouts((prev) => {
        const idx = prev.findIndex((l) => l.id === id)
        if (idx >= 0) {
          const copy = [...prev]
          copy[idx] = layout
          return copy
        }
        return [layout, ...prev]
      })
      setSaveStatus('Saved!')
      window.setTimeout(() => setSaveStatus(null), 2000)
    } catch {
      setSaveStatus('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Load a saved layout ──────────────────────────────────────────────────
  const handleLoadLayout = (layout: DashboardLayoutRecord) => {
    try {
      const parsed: DashboardWidget[] = JSON.parse(layout.widgetsJson)
      setWidgets(parsed)
      setActiveLayoutId(layout.id)
      setLayoutName(layout.name)
    } catch {/* invalid JSON — ignore */}
  }

  // ── Delete a saved layout ────────────────────────────────────────────────
  const handleDeleteLayout = async (id: string) => {
    await window.db.deleteDashboardLayout(id).catch((err: unknown) => { console.error('Failed to delete dashboard layout:', err) })
    setSavedLayouts((prev) => prev.filter((l) => l.id !== id))
    if (activeLayoutId === id) setActiveLayoutId(null)
  }

  const gridLayout = widgets.map((w) => ({
    i: w.i,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: 3,
    minH: 3,
  }))

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Panel */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          margin: '24px',
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-xl)',
          backdropFilter: 'var(--glass-blur)',
          overflow: 'hidden',
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderBottom: '1px solid var(--glass-border)',
            flexShrink: 0,
          }}
        >
          <BarChart2 size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
            Metric Dashboard
          </span>

          <input
            className="input-field"
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
            placeholder="Dashboard name"
            style={{ width: 180, marginLeft: 8 }}
          />

          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)' }}
            onClick={() => setShowAddWidget(true)}
          >
            <Plus size={12} /> Add Widget
          </button>

          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)' }}
            onClick={() => refreshAll(widgets)}
          >
            <RefreshCw size={12} /> Refresh
          </button>

          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)' }}
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>

          {saveStatus && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success)' }}>
              {saveStatus}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Saved layouts selector */}
          {savedLayouts.length > 0 && (
            <select
              className="input-field"
              value={activeLayoutId ?? ''}
              onChange={(e) => {
                const layout = savedLayouts.find((l) => l.id === e.target.value)
                if (layout) handleLoadLayout(layout)
              }}
              style={{ width: 160, fontSize: 'var(--font-size-xs)' }}
            >
              <option value="">Load saved…</option>
              {savedLayouts.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}

          {activeLayoutId && (
            <button
              className="icon-btn"
              onClick={() => handleDeleteLayout(activeLayoutId)}
              title="Delete current layout"
              style={{ color: 'var(--color-error)' }}
            >
              <Trash2 size={13} />
            </button>
          )}

          <button className="icon-btn" onClick={onClose} title="Close dashboard">
            <X size={15} />
          </button>
        </div>

        {/* Grid area */}
        <div
          ref={containerRef}
          style={{ flex: 1, overflow: 'auto', padding: 12 }}
        >
          {widgets.length === 0 ? (
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                color: 'var(--text-tertiary)',
              }}
            >
              <BarChart2 size={40} />
              <span style={{ fontSize: 'var(--font-size-sm)' }}>No widgets yet.</span>
              <button
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)' }}
                onClick={() => setShowAddWidget(true)}
              >
                <Plus size={12} /> Add your first widget
              </button>
            </div>
          ) : (
            <GridLayout
              className="layout"
              layout={gridLayout}
              cols={GRID_COLS}
              rowHeight={GRID_ROW_HEIGHT}
              width={gridWidth}
              onLayoutChange={handleLayoutChange}
              draggableHandle=".dashboard-widget-drag-handle"
              resizeHandles={['se']}
              margin={[8, 8]}
            >
              {widgets.map((widget) => (
                <div key={widget.i}>
                  {(widget.widgetType ?? 'metric') === 'sql-query' ? (
                    <SqlQueryWidgetCard
                      widget={widget}
                      data={sqlData[widget.i] ?? []}
                      loading={loadingSql[widget.i] ?? false}
                      error={sqlErrors[widget.i] ?? null}
                      onRemove={handleRemoveWidget}
                      onRerun={(id) => {
                        const w = widgets.find((x) => x.i === id)
                        if (w) runSqlWidget(w)
                      }}
                    />
                  ) : (
                    <MetricWidgetCard
                      widget={widget}
                      data={metricData[widget.metricId ?? ''] ?? []}
                      loading={loadingMetrics[widget.metricId ?? ''] ?? false}
                      onRemove={handleRemoveWidget}
                    />
                  )}
                </div>
              ))}
            </GridLayout>
          )}
        </div>
      </div>

      {showAddWidget && (
        <AddWidgetModal
          onAddMetric={handleAddMetricWidget}
          onAddSqlQuery={handleAddSqlQueryWidget}
          onCancel={() => setShowAddWidget(false)}
          connections={connections}
        />
      )}
    </div>
  )
}
