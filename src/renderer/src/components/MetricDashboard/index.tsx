import React, { useCallback, useEffect, useRef, useState } from 'react'
import GridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { X, Plus, Save, Trash2, RefreshCw, BarChart2 } from 'lucide-react'
import type { ConnectionConfig } from '../../types'

import { DashboardWidget, DashboardLayoutRecord, ChartType } from './types'
import { MetricWidgetCard } from './MetricWidgetCard'
import { SqlQueryWidgetCard } from './SqlQueryWidgetCard'
import { AddWidgetModal } from './AddWidgetModal'
import { useDashboardStore } from '../../store/dashboardSlice'

interface Props {
  onClose: () => void
}

const GRID_COLS = 12
const GRID_ROW_HEIGHT = 40

function genId(): string {
  return crypto.randomUUID()
}

export function DashboardBuilder({ onClose }: Props): React.JSX.Element {
  const {
    widgets, setWidgets,
    metricData, setMetricData, setLoadingMetric,
    sqlData, setSqlData, loadingSql, setLoadingSql, sqlErrors, setSqlError,
    savedLayouts, setSavedLayouts,
    activeLayoutId, setActiveLayoutId,
    layoutName, setLayoutName,
    addWidget, removeWidget, updateWidgetLayouts
  } = useDashboardStore()

  const [loadingMetricsLocal, setLoadingMetricsLocal] = useState<Record<string, boolean>>({})
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
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
    
    window.db.getConnections().then((conns) => {
      setConnections(conns)
      // Auto-generate widgets if empty and we have a connection
      if (conns.length > 0 && useDashboardStore.getState().widgets.length === 0 && !useDashboardStore.getState().activeLayoutId) {
        const defaultConnection = conns[0].id
        if (defaultConnection) {
          const w1: DashboardWidget = { i: genId(), widgetType: 'metric', metricId: 'active_connections', title: 'Active Connections', connectionId: defaultConnection, x: 0, y: 0, w: 6, h: 4 }
          const w2: DashboardWidget = { i: genId(), widgetType: 'metric', metricId: 'queries_per_minute', title: 'Queries Per Minute', connectionId: defaultConnection, x: 6, y: 0, w: 6, h: 4 }
          const w3: DashboardWidget = { i: genId(), widgetType: 'metric', metricId: 'query_exec_time', title: 'Query Exec Time', connectionId: defaultConnection, x: 0, y: 4, w: 6, h: 4 }
          const w4: DashboardWidget = { i: genId(), widgetType: 'metric', metricId: 'row_counts', title: 'Row Count', connectionId: defaultConnection, x: 6, y: 4, w: 6, h: 4 }
          
          setWidgets([w1, w2, w3, w4])
        }
      }
    }).catch(() => {/* not fatal */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Run a single SQL query widget ────────────────────────────────────────
  const runSqlWidget = useCallback(async (widget: DashboardWidget) => {
    if (!widget.connectionId || !widget.sqlQuery) return
    setLoadingSql(widget.i, true)
    setSqlError(widget.i, null)
    try {
      const result = await window.db.query(widget.connectionId, widget.sqlQuery)
      if (result.error) {
        setSqlError(widget.i, result.error)
        setSqlData(widget.i, [])
      } else {
        setSqlData(widget.i, result.rows as any[])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSqlError(widget.i, msg)
      setSqlData(widget.i, [])
    } finally {
      setLoadingSql(widget.i, false)
    }
  }, [setLoadingSql, setSqlError, setSqlData])

  // ── Fetch metric data for all metric widgets ──────────────────────────────
  const fetchAllMetrics = useCallback(async (currentWidgets: DashboardWidget[]) => {
    const metricWidgets = currentWidgets.filter((w) => (w.widgetType ?? 'metric') === 'metric')
    await Promise.all(
      metricWidgets.map(async (widget) => {
        if (!widget.connectionId || !widget.metricId) return
        setLoadingMetricsLocal((prev) => ({ ...prev, [widget.i]: true }))
        try {
          const result = await window.db.getMetricData(widget.connectionId, widget.metricId, { points: 20 })
          setMetricData(widget.i, result.data)
        } catch (err) {
          console.error(`Failed to fetch metric data for ${widget.metricId}:`, err)
        } finally {
          setLoadingMetricsLocal((prev) => ({ ...prev, [widget.i]: false }))
        }
      })
    )
  }, [setMetricData])

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
    updateWidgetLayouts(layout)
  }

  // ── Add metric widget ────────────────────────────────────────────────────
  const handleAddMetricWidget = (metricId: string, title: string, connectionId: string) => {
    const id = genId()
    const newWidget: DashboardWidget = {
      i: id,
      widgetType: 'metric',
      metricId,
      title,
      connectionId,
      x: 0,
      y: 0,
      w: 6,
      h: 4,
    }
    addWidget(newWidget)
    setShowAddWidget(false)
    window.db.getMetricData(connectionId, metricId, { points: 20 })
      .then((result) => setMetricData(id, result.data))
      .catch((err) => { console.error(`Failed to fetch metric data for ${metricId}:`, err) })
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
      x: 0,
      y: 0,
      w: 6,
      h: 4,
    }
    addWidget(newWidget)
    setShowAddWidget(false)
    runSqlWidget(newWidget)
  }

  // ── Remove widget ────────────────────────────────────────────────────────
  const handleRemoveWidget = (id: string) => {
    removeWidget(id)
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
                      loading={loadingMetricsLocal[widget.metricId ?? ''] ?? false}
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
