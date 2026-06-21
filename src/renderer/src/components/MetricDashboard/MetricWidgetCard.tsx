import React from 'react'
import { X } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { DashboardWidget, MetricDataPoint } from './types'

export const AVAILABLE_METRICS: Array<{ id: string; label: string; unit: string }> = [
  { id: 'active_connections', label: 'Active Connections', unit: '' },
  { id: 'queries_per_minute', label: 'Queries / Minute', unit: 'qpm' },
  { id: 'query_exec_time', label: 'Query Exec Time', unit: 'ms' },
  { id: 'row_counts', label: 'Row Count', unit: 'rows' },
]

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

export interface MetricWidgetCardProps {
  widget: DashboardWidget
  data: MetricDataPoint[]
  loading: boolean
  onRemove: (id: string) => void
}

export function MetricWidgetCard({ widget, data, loading, onRemove }: MetricWidgetCardProps): React.JSX.Element {
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
