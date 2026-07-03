import neo4j, { Driver, Session } from 'neo4j-driver'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

/**
 * Validates a Neo4j node label for use in Cypher pattern matching.
 * Neo4j labels must start with a letter/underscore and contain only alphanumeric chars and underscores,
 * or can be any string when backtick-escaped (we validate to prevent injection).
 */
function validateNeo4jLabel(label: string): string {
  if (!label || /[`\x00-\x1F]/.test(label)) {
    throw new Error(`Invalid Neo4j label: "${label}"`)
  }
  return label
}

export class Neo4jAdapter implements DatabaseAdapter {
  dialect: ConnectionConfig['type'] = 'neo4j'
  private driver: Driver | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    const protocol = config.ssl ? 'neo4j+s' : 'neo4j'
    const host = config.host || 'localhost'
    const port = config.port || 7687
    const uri = `${protocol}://${host}:${port}`

    const auth = config.user
      ? neo4j.auth.basic(config.user, config.password ?? '')
      : neo4j.auth.none()

    this.driver = neo4j.driver(uri, auth, {
      maxConnectionPoolSize: 5,
      connectionAcquisitionTimeout: 10000
    })
    await this.driver.verifyConnectivity()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close()
      this.driver = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.driver !== null
  }

  private getSession(database?: string): Session {
    if (!this.driver) throw new Error('Not connected')
    return this.driver.session({ database: database || this.config?.database || 'neo4j' })
  }

  async query(cypher: string, _params: unknown[] = []): Promise<QueryResult> {
    const session = this.getSession()
    const start = Date.now()
    try {
      const result = await session.run(cypher)
      const rows = result.records.map((record) => {
        const obj: Record<string, unknown> = {}
        record.keys.forEach((key) => {
          const val = record.get(key)
          // Convert Neo4j Integer types to JS numbers
          obj[String(key)] = neo4j.isInt(val) ? val.toNumber() : val
        })
        return obj
      })
      const columnSet = new Set<string>()
      rows.forEach((row) => Object.keys(row).forEach((k) => columnSet.add(k)))
      const columns = Array.from(columnSet).map((name) => ({ name, type: 'string' }))
      return { columns, rows, rowCount: rows.length, duration: Date.now() - start }
    } finally {
      await session.close()
    }
  }

  async getDatabases(): Promise<string[]> {
    const session = this.getSession('system')
    try {
      const result = await session.run('SHOW DATABASES')
      return result.records
        .map((r) => String(r.get('name')))
        .filter((name) => name !== 'system')
    } catch {
      return [this.config?.database || 'neo4j']
    } finally {
      await session.close()
    }
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    const session = this.getSession(database)
    try {
      const result = await session.run('CALL db.labels()')
      return result.records.map((r) => ({ name: String(r.get('label')), type: 'table' as const }))
    } finally {
      await session.close()
    }
  }

  async getColumns(label: string, database?: string): Promise<ColumnInfo[]> {
    const session = this.getSession(database)
    try {
      const safeLabel = validateNeo4jLabel(label)
      // Sample a node to infer property keys. Backtick-escaping the label after validation.
      const result = await session.run(
        `MATCH (n:\`${safeLabel.replace(/`/g, '``')}\`) RETURN keys(n) AS keys LIMIT 1`
      )
      if (result.records.length === 0) return []
      const keys: string[] = result.records[0].get('keys') as string[]
      return keys.map((k) => ({ name: k, type: 'string', nullable: true, primaryKey: false }))
    } finally {
      await session.close()
    }
  }

  async getForeignKeys(_table: string, _database?: string): Promise<ForeignKeyInfo[]> {
    return []
  }

  async getProcedures(_database?: string): Promise<ProcedureInfo[]> {
    const session = this.getSession()
    try {
      const result = await session.run('CALL dbms.procedures() YIELD name')
      return result.records.map((r) => ({
        name: String(r.get('name')),
        type: 'procedure' as const
      }))
    } catch {
      return []
    } finally {
      await session.close()
    }
  }

  async ping(): Promise<boolean> {
    if (!this.driver) return false
    try {
      await this.driver.verifyConnectivity()
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    const session = this.getSession()
    try {
      const result = await session.run('CALL dbms.components() YIELD name, version RETURN name, version')
      if (result.records.length > 0) {
        const name = result.records[0].get('name')
        const version = result.records[0].get('version')
        return `${name} ${version}`
      }
      return 'Neo4j'
    } catch {
      return 'Neo4j'
    } finally {
      await session.close()
    }
  }
}
