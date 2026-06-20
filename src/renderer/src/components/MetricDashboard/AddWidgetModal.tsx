import React, { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import type { ConnectionConfig } from '../../types'
import { WidgetType, ChartType } from './types'
import { AVAILABLE_METRICS } from './MetricWidgetCard'
import { useThemeClass } from '../../hooks/useThemeClass'

export interface AddWidgetModalProps {
  onAddMetric: (metricId: string, title: string, connectionId: string) => void
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

export function AddWidgetModal({ onAddMetric, onAddSqlQuery, onCancel, connections }: AddWidgetModalProps): React.JSX.Element {
  const [widgetType, setWidgetType] = useState<WidgetType>('metric')
  const [metricId, setMetricId] = useState(AVAILABLE_METRICS[0].id)
  const [metricTitle, setMetricTitle] = useState(AVAILABLE_METRICS[0].label)
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '')
  const [sqlQuery, setSqlQuery] = useState('')
  const [sqlTitle, setSqlTitle] = useState('SQL Query')
  const [xKey, setXKey] = useState('')
  const [yKey, setYKey] = useState('')
  const [chartType, setChartType] = useState<ChartType>('bar')
  const themeClass = useThemeClass()

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
      if (metricTitle.trim() && connectionId) {
        onAddMetric(metricId, metricTitle.trim(), connectionId)
      }
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

  return (
    <div
      className={themeClass}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          width: 500,
          maxWidth: '90vw',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          backdropFilter: 'var(--glass-blur)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--glass-border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Add Widget</h2>
          <button className="icon-btn" onClick={onCancel} title="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="widgetType"
                checked={widgetType === 'metric'}
                onChange={() => setWidgetType('metric')}
              />
              <span style={{ fontSize: 'var(--font-size-sm)' }}>Built-in Metric</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="widgetType"
                checked={widgetType === 'sql-query'}
                onChange={() => setWidgetType('sql-query')}
              />
              <span style={{ fontSize: 'var(--font-size-sm)' }}>Custom SQL Chart</span>
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Connection
            </label>
            <select
              className="input-field"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {connections.length === 0 && <option value="">No connections available</option>}
            </select>
          </div>

          {widgetType === 'metric' ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Metric Type
                </label>
                <select
                  className="input-field"
                  value={metricId}
                  onChange={(e) => handleMetricChange(e.target.value)}
                >
                  {AVAILABLE_METRICS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Widget Title
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={metricTitle}
                  onChange={(e) => setMetricTitle(e.target.value)}
                  placeholder="e.g. Active Connections"
                />
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Widget Title
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={sqlTitle}
                  onChange={(e) => setSqlTitle(e.target.value)}
                  placeholder="e.g. Users Over Time"
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  SQL Query (returns 2+ columns)
                </label>
                <textarea
                  className="input-field"
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="SELECT date, count(*) as total FROM users GROUP BY date ORDER BY date DESC LIMIT 30"
                  style={{ height: 80, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
                />
                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  Query execution timeout: 30s. Hard limit: 1000 rows.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    X-Axis Column (Optional)
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={xKey}
                    onChange={(e) => setXKey(e.target.value)}
                    placeholder="Auto (1st col)"
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Y-Axis Column (Optional)
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={yKey}
                    onChange={(e) => setYKey(e.target.value)}
                    placeholder="Auto (2nd col)"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Chart Type
                </label>
                <select
                  className="input-field"
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value as ChartType)}
                >
                  <option value="bar">Bar Chart</option>
                  <option value="line">Line Chart</option>
                </select>
              </div>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            padding: '16px 20px',
            borderTop: '1px solid var(--glass-border)',
            background: 'var(--bg-secondary)',
          }}
        >
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={
              widgetType === 'metric' ? !metricTitle.trim() || !connectionId : !connectionId || !sqlQuery.trim() || !sqlTitle.trim()
            }
          >
            <Plus size={16} />
            Add Widget
          </button>
        </div>
      </div>
    </div>
  )
}
