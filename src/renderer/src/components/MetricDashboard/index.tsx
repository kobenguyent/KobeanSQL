/**
 * MetricDashboard — drag-and-drop dashboard for database metrics.
 *
 * Architecture:
 *  - react-grid-layout provides the resizable/draggable grid.
 *  - recharts renders each widget's line chart.
 *  - All metric data is fetched via window.db.getMetricData (Electron IPC).
 *  - Dashboard layouts are saved to SQLite via window.db.saveDashboardLayout.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import GridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { X, Plus, Save, Trash2, RefreshCw, BarChart2 } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardWidget {
  /** react-grid-layout key */
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
  widgetsJson: string
  updatedAt: number
}

interface MetricDataPoint {
  timestamp: number
  value: number
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
  { i: 'w1', metricId: 'active_connections', title: 'Active Connections', x: 0, y: 0, w: 6, h: 4 },
  { i: 'w2', metricId: 'queries_per_minute', title: 'Queries Per Minute', x: 6, y: 0, w: 6, h: 4 },
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
// WidgetCard
// ---------------------------------------------------------------------------

interface WidgetCardProps {
  widget: DashboardWidget
  data: MetricDataPoint[]
  loading: boolean
  onRemove: (id: string) => void
}

function WidgetCard({ widget, data, loading, onRemove }: WidgetCardProps): React.JSX.Element {
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
// AddWidgetModal
// ---------------------------------------------------------------------------

interface AddWidgetModalProps {
  onAdd: (metricId: string, title: string) => void
  onCancel: () => void
}

function AddWidgetModal({ onAdd, onCancel }: AddWidgetModalProps): React.JSX.Element {
  const [metricId, setMetricId] = useState(AVAILABLE_METRICS[0].id)
  const [title, setTitle] = useState(AVAILABLE_METRICS[0].label)

  const handleMetricChange = (id: string) => {
    setMetricId(id)
    const meta = AVAILABLE_METRICS.find((m) => m.id === id)
    if (meta) setTitle(meta.label)
  }

  return (
    <div
      className="modal-overlay"
      onClick={onCancel}
      style={{ zIndex: 1400 }}
    >
      <div
        className="modal-panel"
        style={{ maxWidth: 360 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Add Widget</span>
          <button className="icon-btn" onClick={onCancel}><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Widget title"
            />
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => title.trim() && onAdd(metricId, title.trim())}
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

  // ── Load saved layouts on mount ──────────────────────────────────────────
  useEffect(() => {
    window.db.getDashboardLayouts().then((layouts) => {
      setSavedLayouts(layouts)
    }).catch((err) => { console.error('Failed to load dashboard layouts:', err) })
  }, [])

  // ── Fetch metric data for all widgets ────────────────────────────────────
  const fetchAllMetrics = useCallback(async (currentWidgets: DashboardWidget[]) => {
    const uniqueMetricIds = [...new Set(currentWidgets.map((w) => w.metricId))]
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

  useEffect(() => {
    fetchAllMetrics(widgets)
    const timer = window.setInterval(() => fetchAllMetrics(widgetsRef.current), 60_000)
    return () => window.clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAllMetrics])

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

  // ── Add widget ───────────────────────────────────────────────────────────
  const handleAddWidget = (metricId: string, title: string) => {
    const id = genId()
    const newWidget: DashboardWidget = {
      i: id,
      metricId,
      title,
      x: (widgets.length * 4) % GRID_COLS,
      y: Infinity,
      w: 6,
      h: 4,
    }
    setWidgets((prev) => [...prev, newWidget])
    setShowAddWidget(false)
    // Fetch metric data for the new widget's metric if not already present
    if (!metricData[metricId]) {
      window.db.getMetricData(metricId, { points: 20 })
        .then((result) => setMetricData((prev) => ({ ...prev, [metricId]: result.data })))
        .catch((err) => { console.error(`Failed to fetch metric data for ${metricId}:`, err) })
    }
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
            onClick={() => fetchAllMetrics(widgets)}
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
                  <WidgetCard
                    widget={widget}
                    data={metricData[widget.metricId] ?? []}
                    loading={loadingMetrics[widget.metricId] ?? false}
                    onRemove={handleRemoveWidget}
                  />
                </div>
              ))}
            </GridLayout>
          )}
        </div>
      </div>

      {showAddWidget && (
        <AddWidgetModal
          onAdd={handleAddWidget}
          onCancel={() => setShowAddWidget(false)}
        />
      )}
    </div>
  )
}
