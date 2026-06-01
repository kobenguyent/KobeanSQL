import { MongoClient, ObjectId } from 'mongodb'
import { DatabaseAdapter } from '../adapter'
import { ColumnInfo, ConnectionConfig, ForeignKeyInfo, ProcedureInfo, QueryResult, TableInfo } from '../types'
import { resolveConnectionConfig } from '../connection-uri'

const SUPPORTED_COLLECTION_METHODS = [
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'countDocuments'
] as const

type MongoCollectionMethod = (typeof SUPPORTED_COLLECTION_METHODS)[number]

type MongoOperation =
  | {
      kind: 'find'
      collection: string
      filter: Record<string, unknown>
      projection?: Record<string, unknown>
      limit?: number
    }
  | {
      kind: 'aggregate'
      collection: string
      pipeline: Record<string, unknown>[]
    }
  | {
      kind: 'collectionCommand'
      collection: string
      method: MongoCollectionMethod
      args: unknown[]
    }
  | {
      kind: 'runCommand'
      command: Record<string, unknown>
    }

function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let escaped = false

  for (const char of args) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      current += char
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      current += char
      continue
    }
    if (!inString && (char === '{' || char === '[')) depth += 1
    if (!inString && (char === '}' || char === ']')) depth -= 1
    if (!inString && depth === 0 && char === ',') {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) parts.push(current.trim())
  return parts
}

function parseJsonArg<T>(value: string, fallback: T): T {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return reviveMongoValue(parsed) as T
  } catch {
    throw new Error('MongoDB query arguments must be valid JSON')
  }
}

function reviveMongoValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => reviveMongoValue(entry))
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Object.keys(record).length === 1) {
      if (typeof record.$oid === 'string') {
        try {
          return new ObjectId(record.$oid)
        } catch {
          // Keep invalid IDs as plain objects so users see a normal query error.
        }
      }
      if (typeof record.$date === 'string' || typeof record.$date === 'number') {
        return new Date(record.$date)
      }
    }
    const revived: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(record)) {
      revived[key] = reviveMongoValue(nestedValue)
    }
    return revived
  }
  return value
}

function toDocument(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(errorMessage)
  return value as Record<string, unknown>
}

function toDocumentArray(value: unknown, errorMessage: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(errorMessage)
  return value.map((entry) => toDocument(entry, errorMessage))
}

function toOptionalDocument(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  return toDocument(value, 'MongoDB options argument must be a JSON object')
}

function isSupportedCollectionMethod(method: string): method is MongoCollectionMethod {
  return (SUPPORTED_COLLECTION_METHODS as readonly string[]).includes(method)
}

function parseCollectionNameLiteral(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed) as string
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'")
  }
  throw new Error('MongoDB collection name in getCollection() must be a quoted string literal')
}

function parseCollectionInvocation(sql: string): { collection: string; method: string; rawArgs: string } | null {
  const directMatch = /^db\.([A-Za-z0-9_$-]+)\.([A-Za-z][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(sql)
  if (directMatch) {
    const [, collection, method, rawArgs] = directMatch
    return { collection, method, rawArgs }
  }

  const getCollectionMatch = /^db\.getCollection\(([\s\S]+)\)\.([A-Za-z][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(sql)
  if (getCollectionMatch) {
    const [, rawCollection, method, rawArgs] = getCollectionMatch
    return { collection: parseCollectionNameLiteral(rawCollection), method, rawArgs }
  }

  return null
}

function buildResultFromRows(rows: Record<string, unknown>[], duration: number): QueryResult {
  return {
    columns: buildColumnsFromRows(rows),
    rows: rows.map((row) => normalizeMongoDocument(row)),
    rowCount: rows.length,
    duration
  }
}

export function parseMongoOperation(query: string): MongoOperation {
  const sql = query.trim().replace(/;$/, '')

  const findMatch = /^db\.(?:([A-Za-z0-9_$-]+)|getCollection\(([\s\S]+)\))\.find\(([\s\S]*?)\)(?:\.limit\((\d+)\))?$/.exec(sql)
  if (findMatch) {
    const collection = findMatch[1] || parseCollectionNameLiteral(findMatch[2])
    const rawArgs = findMatch[3]
    const rawLimit = findMatch[4]
    const [filterArg = '{}', projectionArg] = splitTopLevelArgs(rawArgs)
    return {
      kind: 'find',
      collection,
      filter: parseJsonArg<Record<string, unknown>>(filterArg, {}),
      projection: projectionArg ? parseJsonArg<Record<string, unknown>>(projectionArg, {}) : undefined,
      limit: rawLimit ? Number.parseInt(rawLimit, 10) : undefined
    }
  }

  const aggregateMatch = /^db\.(?:([A-Za-z0-9_$-]+)|getCollection\(([\s\S]+)\))\.aggregate\(([\s\S]*)\)$/.exec(sql)
  if (aggregateMatch) {
    const collection = aggregateMatch[1] || parseCollectionNameLiteral(aggregateMatch[2])
    const rawPipeline = aggregateMatch[3]
    const pipeline = parseJsonArg<Record<string, unknown>[]>(rawPipeline, [])
    if (!Array.isArray(pipeline)) throw new Error('MongoDB aggregate pipeline must be a JSON array')
    return { kind: 'aggregate', collection, pipeline }
  }

  const runCommandMatch = /^db\.runCommand\((.*)\)$/.exec(sql)
  if (runCommandMatch) {
    const command = parseJsonArg<Record<string, unknown>>(runCommandMatch[1], {})
    return { kind: 'runCommand', command }
  }

  const commandMatch = parseCollectionInvocation(sql)
  if (commandMatch) {
    const { collection, method, rawArgs } = commandMatch
    if (!isSupportedCollectionMethod(method)) throw new Error('Unsupported MongoDB query.')
    const args = rawArgs.trim() ? splitTopLevelArgs(rawArgs).map((arg) => parseJsonArg(arg, null)) : []
    return {
      kind: 'collectionCommand',
      collection,
      method,
      args
    }
  }

  throw new Error('Unsupported MongoDB query.')
}

function inferMongoType(value: unknown): string {
  if (value === null || value === undefined) return 'unknown'
  if (value instanceof Date) return 'date'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function normalizeMongoValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeMongoValue)
  if (value && typeof value === 'object') {
    if ('toHexString' in value && typeof value.toHexString === 'function') {
      return value.toHexString()
    }
    const normalized: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeMongoValue(nestedValue)
    }
    return normalized
  }
  return value
}

function normalizeMongoDocument(document: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(document)) {
    normalized[key] = normalizeMongoValue(value)
  }
  return normalized
}

function buildColumnsFromRows(rows: Record<string, unknown>[]): QueryResult['columns'] {
  const fields = new Map<string, string>()
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!fields.has(key) || fields.get(key) === 'unknown') {
        fields.set(key, inferMongoType(value))
      }
    }
  }
  return Array.from(fields.entries()).map(([name, type]) => ({
    name,
    type,
    nullable: true,
    primaryKey: name === '_id'
  }))
}

function buildManualMongoUri(config: ConnectionConfig): string {
  const host = encodeURIComponent(config.host || 'localhost')
  const port = config.port || 27017
  const database = encodeURIComponent(config.database || 'admin')
  const credentials =
    config.user || config.password
      ? `${encodeURIComponent(config.user || '')}:${encodeURIComponent(config.password || '')}@`
      : ''
  return `mongodb://${credentials}${host}:${port}/${database}`
}

export class MongoDBAdapter implements DatabaseAdapter {
  private client: MongoClient | null = null
  private config: ConnectionConfig | null = null
  private connected = false

  async connect(config: ConnectionConfig): Promise<void> {
    const resolvedConfig = resolveConnectionConfig(config)
    const uri = resolvedConfig.connectionUri?.trim() || buildManualMongoUri(resolvedConfig)
    this.config = resolvedConfig
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
    await this.client.connect()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client !== null
  }

  async query(sql: string): Promise<QueryResult> {
    const start = Date.now()
    try {
      if (!this.client) throw new Error('Not connected')
      const operation = parseMongoOperation(sql)
      const dbName = this.config?.database || 'admin'
      if (operation.kind === 'runCommand') {
        const commandResult = await this.client.db(dbName).command(operation.command)
        return buildResultFromRows([commandResult as Record<string, unknown>], Date.now() - start)
      }

      const collection = this.client.db(dbName).collection(operation.collection)

      if (operation.kind === 'find') {
        const documents = await collection
          .find(operation.filter, operation.projection ? { projection: operation.projection } : undefined)
          .limit(operation.limit ?? 100)
          .toArray()
        return buildResultFromRows(documents as Record<string, unknown>[], Date.now() - start)
      }

      if (operation.kind === 'aggregate') {
        const documents = await collection.aggregate(operation.pipeline).toArray()
        return buildResultFromRows(documents as Record<string, unknown>[], Date.now() - start)
      }

      switch (operation.method) {
        case 'insertOne': {
          const document = toDocument(operation.args[0], 'insertOne requires one JSON document argument')
          const insertResult = await collection.insertOne(document)
          return buildResultFromRows([{
            acknowledged: insertResult.acknowledged,
            insertedId: normalizeMongoValue(insertResult.insertedId)
          }], Date.now() - start)
        }
        case 'insertMany': {
          const documents = toDocumentArray(operation.args[0], 'insertMany requires one JSON array argument')
          const insertManyResult = await collection.insertMany(documents)
          return buildResultFromRows([{
            acknowledged: insertManyResult.acknowledged,
            insertedCount: insertManyResult.insertedCount,
            insertedIds: normalizeMongoValue(insertManyResult.insertedIds)
          }], Date.now() - start)
        }
        case 'updateOne':
        case 'updateMany': {
          const filter = toDocument(operation.args[0], `${operation.method} requires a filter JSON object`)
          const update = operation.args[1]
          if (
            !update ||
            typeof update !== 'object' ||
            (!Array.isArray(update) && Object.keys(update as Record<string, unknown>).length === 0)
          ) {
            throw new Error(`${operation.method} requires an update document or pipeline`)
          }
          const options = toOptionalDocument(operation.args[2])
          const updateResult =
            operation.method === 'updateOne'
              ? await collection.updateOne(filter, update as Record<string, unknown>, options)
              : await collection.updateMany(filter, update as Record<string, unknown>, options)
          return buildResultFromRows([{
            acknowledged: updateResult.acknowledged,
            matchedCount: updateResult.matchedCount,
            modifiedCount: updateResult.modifiedCount,
            upsertedId: normalizeMongoValue(updateResult.upsertedId),
            upsertedCount: updateResult.upsertedCount
          }], Date.now() - start)
        }
        case 'replaceOne': {
          const filter = toDocument(operation.args[0], 'replaceOne requires a filter JSON object')
          const replacement = toDocument(operation.args[1], 'replaceOne requires a replacement JSON object')
          const options = toOptionalDocument(operation.args[2])
          const replaceResult = await collection.replaceOne(filter, replacement, options)
          return buildResultFromRows([{
            acknowledged: replaceResult.acknowledged,
            matchedCount: replaceResult.matchedCount,
            modifiedCount: replaceResult.modifiedCount,
            upsertedId: normalizeMongoValue(replaceResult.upsertedId),
            upsertedCount: replaceResult.upsertedCount
          }], Date.now() - start)
        }
        case 'deleteOne':
        case 'deleteMany': {
          const filter = toDocument(operation.args[0], `${operation.method} requires a filter JSON object`)
          const options = toOptionalDocument(operation.args[1])
          const deleteResult =
            operation.method === 'deleteOne'
              ? await collection.deleteOne(filter, options)
              : await collection.deleteMany(filter, options)
          return buildResultFromRows([{
            acknowledged: deleteResult.acknowledged,
            deletedCount: deleteResult.deletedCount
          }], Date.now() - start)
        }
        case 'findOneAndUpdate': {
          const filter = toDocument(operation.args[0], 'findOneAndUpdate requires a filter JSON object')
          const update = operation.args[1]
          if (!update || typeof update !== 'object') {
            throw new Error('findOneAndUpdate requires an update document or pipeline')
          }
          const options = toOptionalDocument(operation.args[2])
          const document = await collection.findOneAndUpdate(filter, update as Record<string, unknown>, options)
          return buildResultFromRows(document ? [document as Record<string, unknown>] : [], Date.now() - start)
        }
        case 'findOneAndDelete': {
          const filter = toDocument(operation.args[0], 'findOneAndDelete requires a filter JSON object')
          const options = toOptionalDocument(operation.args[1])
          const document = await collection.findOneAndDelete(filter, options)
          return buildResultFromRows(document ? [document as Record<string, unknown>] : [], Date.now() - start)
        }
        case 'findOneAndReplace': {
          const filter = toDocument(operation.args[0], 'findOneAndReplace requires a filter JSON object')
          const replacement = toDocument(operation.args[1], 'findOneAndReplace requires a replacement JSON object')
          const options = toOptionalDocument(operation.args[2])
          const document = await collection.findOneAndReplace(filter, replacement, options)
          return buildResultFromRows(document ? [document as Record<string, unknown>] : [], Date.now() - start)
        }
        case 'countDocuments': {
          const filter = operation.args[0]
          const parsedFilter =
            filter === undefined
              ? {}
              : toDocument(filter, 'countDocuments filter must be a JSON object')
          const count = await collection.countDocuments(parsedFilter)
          return buildResultFromRows([{ count }], Date.now() - start)
        }
      }

      throw new Error('Unsupported MongoDB query.')
    } catch (err) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        duration: Date.now() - start,
        error: (err as Error).message
      }
    }
  }

  async getDatabases(): Promise<string[]> {
    if (!this.client) throw new Error('Not connected')
    const result = await this.client.db('admin').admin().listDatabases()
    return result.databases.map((database) => database.name)
  }

  async getTables(database?: string): Promise<TableInfo[]> {
    if (!this.client) throw new Error('Not connected')
    const dbName = database || this.config?.database || 'admin'
    const collections = await this.client.db(dbName).listCollections().toArray()
    return collections.map((collection) => ({ name: collection.name, type: 'table' }))
  }

  async getColumns(collectionName: string, database?: string): Promise<ColumnInfo[]> {
    if (!this.client) throw new Error('Not connected')
    const dbName = database || this.config?.database || 'admin'
    const docs = await this.client.db(dbName).collection(collectionName).find({}).limit(25).toArray()
    const fields = new Map<string, string>()
    for (const doc of docs as Array<Record<string, unknown>>) {
      for (const [key, value] of Object.entries(doc)) {
        if (!fields.has(key) || fields.get(key) === 'unknown') {
          fields.set(key, inferMongoType(value))
        }
      }
    }
    return Array.from(fields.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, type]) => ({
        name,
        type,
        nullable: false,
        primaryKey: name === '_id'
      }))
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
      await this.client.db(this.config?.database || 'admin').command({ ping: 1 })
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    try {
      if (!this.client) return 'Unknown'
      const result = await this.client.db('admin').command({ buildInfo: 1 })
      return typeof result.version === 'string' ? `MongoDB ${result.version}` : 'Unknown'
    } catch {
      return 'Unknown'
    }
  }
}
