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
  connectionId: string
  x: number
  y: number
  w: number
  h: number
  /** used when widgetType === 'sql-query' */
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

export interface MetricDataPoint {
  timestamp: number
  value: number
}

export interface SqlDataPoint {
  [key: string]: unknown
}
