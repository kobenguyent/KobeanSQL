import { create } from 'zustand'
import { DashboardWidget, DashboardLayoutRecord, MetricDataPoint, SqlDataPoint } from '../components/MetricDashboard/types'

const GRID_COLS = 12

export interface DashboardState {
  widgets: DashboardWidget[]
  metricData: Record<string, MetricDataPoint[]>
  loadingMetrics: Record<string, boolean>
  sqlData: Record<string, SqlDataPoint[]>
  loadingSql: Record<string, boolean>
  sqlErrors: Record<string, string | null>
  savedLayouts: DashboardLayoutRecord[]
  activeLayoutId: string | null
  layoutName: string

  setWidgets: (widgets: DashboardWidget[] | ((prev: DashboardWidget[]) => DashboardWidget[])) => void
  setMetricData: (widgetId: string, data: MetricDataPoint[]) => void
  setLoadingMetric: (widgetId: string, loading: boolean) => void
  setSqlData: (widgetId: string, data: SqlDataPoint[]) => void
  setLoadingSql: (widgetId: string, loading: boolean) => void
  setSqlError: (widgetId: string, error: string | null) => void
  
  setSavedLayouts: (layouts: DashboardLayoutRecord[] | ((prev: DashboardLayoutRecord[]) => DashboardLayoutRecord[])) => void
  setActiveLayoutId: (id: string | null) => void
  setLayoutName: (name: string) => void

  removeWidget: (id: string) => void
  addWidget: (widget: DashboardWidget) => void
  updateWidgetLayouts: (layout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  widgets: [],
  metricData: {},
  loadingMetrics: {},
  sqlData: {},
  loadingSql: {},
  sqlErrors: {},
  savedLayouts: [],
  activeLayoutId: null,
  layoutName: 'My Dashboard',

  setWidgets: (updater) => set((state) => ({ widgets: typeof updater === 'function' ? updater(state.widgets) : updater })),
  setMetricData: (widgetId, data) => set((state) => ({ metricData: { ...state.metricData, [widgetId]: data } })),
  setLoadingMetric: (widgetId, loading) => set((state) => ({ loadingMetrics: { ...state.loadingMetrics, [widgetId]: loading } })),
  
  setSqlData: (widgetId, data) => set((state) => ({ sqlData: { ...state.sqlData, [widgetId]: data } })),
  setLoadingSql: (widgetId, loading) => set((state) => ({ loadingSql: { ...state.loadingSql, [widgetId]: loading } })),
  setSqlError: (widgetId, error) => set((state) => ({ sqlErrors: { ...state.sqlErrors, [widgetId]: error } })),

  setSavedLayouts: (updater) => set((state) => ({ savedLayouts: typeof updater === 'function' ? updater(state.savedLayouts) : updater })),
  setActiveLayoutId: (id) => set({ activeLayoutId: id }),
  setLayoutName: (name) => set({ layoutName: name }),

  removeWidget: (id) => set((state) => ({ widgets: state.widgets.filter((w) => w.i !== id) })),
  
  addWidget: (widget) => set((state) => ({
    widgets: [...state.widgets, { ...widget, x: (state.widgets.length * 4) % GRID_COLS, y: Infinity, w: 6, h: 4 }]
  })),

  updateWidgetLayouts: (layout) => set((state) => ({
    widgets: state.widgets.map((w) => {
      const updated = layout.find((l) => l.i === w.i)
      return updated ? { ...w, x: updated.x, y: updated.y, w: updated.w, h: updated.h } : w
    })
  }))
}))
