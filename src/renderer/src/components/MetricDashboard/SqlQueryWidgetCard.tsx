import React from 'react'
import { X, Play, AlertCircle } from 'lucide-react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { DashboardWidget, SqlDataPoint } from './types'

export interface SqlQueryWidgetCardProps {
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

export function SqlQueryWidgetCard({
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
  })).reverse()

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
