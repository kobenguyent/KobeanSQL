import Redis from 'ioredis'
import { DatabaseAdapter } from '../adapter'
import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from '../types'

/**
 * Parses a free-form Redis CLI command string into a command + args array.
 * Supports quoted strings (single and double) as single tokens.
 */
function parseRedisCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (const char of input.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (!inSingle && !inDouble && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

function redisValueToString(value: unknown): string {
  if (value === null || value === undefined) return '(nil)'
  if (Array.isArray(value)) return value.map(redisValueToString).join(', ')
  return String(value)
}

export class RedisAdapter implements DatabaseAdapter {
  private client: Redis | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    this.client = new Redis({
      host: config.host || 'localhost',
      port: config.port || 6379,
      password: config.password || undefined,
      db: config.database ? parseInt(config.database, 10) || 0 : 0,
      tls: config.ssl ? {} : undefined,
      connectTimeout: 10000,
      lazyConnect: true
    })
    await this.client.connect()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client !== null
  }

  async query(commandStr: string, _params: unknown[] = []): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected')
    const start = Date.now()
    try {
      const tokens = parseRedisCommand(commandStr)
      if (tokens.length === 0) throw new Error('Empty Redis command')
      const [cmd, ...args] = tokens
      // ioredis call(command, ...args) executes any Redis command
      const result = await (this.client as unknown as { call: (cmd: string, ...args: string[]) => Promise<unknown> }).call(cmd.toUpperCase(), ...args)
      const value = redisValueToString(result)
      return {
        columns: [{ name: 'result', type: 'string', nullable: true, primaryKey: false }],
        rows: [{ result: value }],
        rowCount: 1,
        duration: Date.now() - start
      }
    } catch (err) {
      return { columns: [], rows: [], rowCount: 0, duration: Date.now() - start, error: (err as Error).message }
    }
  }

  async getDatabases(): Promise<string[]> {
    // Redis databases are numbered 0–15 by default (configurable with databases directive)
    return Array.from({ length: 16 }, (_, i) => String(i))
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    if (!this.client) throw new Error('Not connected')
    // Switch DB if requested using SELECT command
    const dbNum = database !== undefined ? parseInt(database, 10) : undefined
    if (dbNum !== undefined && !Number.isNaN(dbNum)) {
      await this.client.select(dbNum)
    }
    try {
      // SCAN for all keys (limited to 100 for performance)
      const [, keys] = await (this.client as Redis).scan(0, 'COUNT', 100)
      return keys.map((key) => ({ name: key, type: 'table' as const }))
    } catch {
      return []
    }
  }

  async getColumns(key: string, _database?: string): Promise<ColumnInfo[]> {
    if (!this.client) throw new Error('Not connected')
    try {
      const type = await this.client.type(key)
      return [{ name: 'value', type, nullable: true, primaryKey: false }]
    } catch {
      return [{ name: 'value', type: 'unknown', nullable: true, primaryKey: false }]
    }
  }

  async getForeignKeys(_table: string, _database?: string): Promise<ForeignKeyInfo[]> {
    return []
  }

  async getProcedures(_database?: string): Promise<ProcedureInfo[]> {
    return []
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.client) return false
      const pong = await this.client.ping()
      return pong === 'PONG'
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      if (!this.client) return 'Unknown'
      const info = await this.client.info('server')
      const match = /^redis_version:(.+)$/m.exec(info)
      return match ? `Redis ${match[1].trim()}` : 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
