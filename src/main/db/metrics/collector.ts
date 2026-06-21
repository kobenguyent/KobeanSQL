import { ConnectionManager } from '../manager'
import { localStore } from '../../local-store'
import { appLogger } from '../../logger'

export class MetricsCollector {
  private timer: NodeJS.Timeout | null = null
  
  constructor(private manager: ConnectionManager, private intervalMs = 60000) {}

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.collect(), this.intervalMs)
    // Run an initial collection slightly delayed to let connections settle
    setTimeout(() => this.collect(), 5000)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async collect() {
    const activeConnections = this.manager.getActiveConnections()
    const timestamp = Date.now()

    for (const { id: connectionId, adapter } of activeConnections) {
      if (typeof adapter.getInstantMetrics === 'function') {
        try {
          const metrics = await adapter.getInstantMetrics()
          for (const [metricId, value] of Object.entries(metrics)) {
            localStore.addMetricData({
              connectionId,
              metricId,
              timestamp,
              value
            })
          }
        } catch (err) {
          appLogger.warn(`Metrics collection failed for ${connectionId}`, { error: (err as Error).message })
        }
      }
    }
  }
}
