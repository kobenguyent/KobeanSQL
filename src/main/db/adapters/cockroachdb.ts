import { PostgresAdapter } from './postgres'
import { ConnectionConfig } from '../types'

/**
 * CockroachDB is wire-compatible with PostgreSQL.
 * This adapter reuses PostgresAdapter with CockroachDB-specific defaults.
 */
export class CockroachDBAdapter extends PostgresAdapter {
  async connect(config: ConnectionConfig): Promise<void> {
    await super.connect({
      ...config,
      port: config.port ?? 26257
    })
  }

  async getServerVersion(): Promise<string> {
    try {
      const result = await this.query('SELECT version() AS version')
      const raw = (result.rows[0]?.['version'] as string) || ''
      // CockroachDB version string: "CockroachDB CCL v23.x.y ..."
      const match = /CockroachDB\s+\w+\s+(v[\d.]+)/i.exec(raw)
      return match ? `CockroachDB ${match[1]}` : raw || 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
