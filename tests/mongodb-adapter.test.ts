import { beforeEach, describe, expect, it, vi } from 'vitest'

const docs = [
  { _id: { toHexString: () => 'abc123' }, name: 'Ada', active: true, score: 42, nested: { level: 1 } },
  { _id: { toString: () => 'def456' }, name: 'Grace', createdAt: new Date('2024-01-01T00:00:00.000Z') }
]

const findLimit = vi.fn()
const findToArray = vi.fn()
const aggregateToArray = vi.fn()
const insertOne = vi.fn()
const insertMany = vi.fn()
const updateOne = vi.fn()
const updateMany = vi.fn()
const replaceOne = vi.fn()
const deleteOne = vi.fn()
const deleteMany = vi.fn()
const findOneAndUpdate = vi.fn()
const findOneAndDelete = vi.fn()
const findOneAndReplace = vi.fn()
const countDocuments = vi.fn()
const connect = vi.fn()
const close = vi.fn()
const db = vi.fn()
const command = vi.fn()
const listDatabases = vi.fn()
const listCollectionsToArray = vi.fn()

vi.mock('mongodb', () => ({
  MongoClient: vi.fn().mockImplementation(function MongoClientMock() {
    return {
    connect,
    close,
    db
    }
  })
}))

describe('MongoDBAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findLimit.mockReturnThis()
    findToArray.mockResolvedValue(docs)
    aggregateToArray.mockResolvedValue([{ status: 'open', total: 2 }])
    insertOne.mockResolvedValue({ acknowledged: true, insertedId: { toHexString: () => 'ins123' } })
    insertMany.mockResolvedValue({
      acknowledged: true,
      insertedCount: 2,
      insertedIds: { 0: { toHexString: () => 'i1' }, 1: { toHexString: () => 'i2' } }
    })
    updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedId: null,
      upsertedCount: 0
    })
    updateMany.mockResolvedValue({
      acknowledged: true,
      matchedCount: 2,
      modifiedCount: 2,
      upsertedId: null,
      upsertedCount: 0
    })
    replaceOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedId: null,
      upsertedCount: 0
    })
    deleteOne.mockResolvedValue({ acknowledged: true, deletedCount: 1 })
    deleteMany.mockResolvedValue({ acknowledged: true, deletedCount: 3 })
    findOneAndUpdate.mockResolvedValue({ _id: { toHexString: () => 'abc123' }, name: 'Ada', active: false })
    findOneAndDelete.mockResolvedValue({ _id: { toHexString: () => 'def456' }, name: 'Grace' })
    findOneAndReplace.mockResolvedValue({ _id: { toHexString: () => 'abc123' }, name: 'Ada v2' })
    countDocuments.mockResolvedValue(7)
    connect.mockResolvedValue(undefined)
    close.mockResolvedValue(undefined)
    command.mockResolvedValue({ ok: 1, version: '7.0.4' })
    listDatabases.mockResolvedValue({ databases: [{ name: 'admin' }, { name: 'app' }] })
    listCollectionsToArray.mockResolvedValue([{ name: 'users' }, { name: 'orders' }])
    db.mockReturnValue({
      admin: () => ({ listDatabases }),
      command,
      listCollections: () => ({ toArray: listCollectionsToArray }),
      collection: () => ({
        find: vi.fn(() => ({ limit: findLimit, toArray: findToArray })),
        aggregate: vi.fn(() => ({ toArray: aggregateToArray })),
        insertOne,
        insertMany,
        updateOne,
        updateMany,
        replaceOne,
        deleteOne,
        deleteMany,
        findOneAndUpdate,
        findOneAndDelete,
        findOneAndReplace,
        countDocuments
      })
    })
  })

  it('connects using URI mode with server selection timeout', async () => {
    const { MongoClient } = await import('mongodb')
    const { MongoDBAdapter } = await import('../src/main/db/adapters/mongodb')
    const adapter = new MongoDBAdapter()

    await adapter.connect({
      id: 'mongo-1',
      name: 'Atlas',
      type: 'mongodb',
      connectionUri: 'mongodb+srv://user:pass@example.mongodb.net/app' // betterleaks:allow - test fixture
    })

    expect(MongoClient).toHaveBeenCalledWith('mongodb+srv://user:pass@example.mongodb.net/app', { // betterleaks:allow - test fixture
      serverSelectionTimeoutMS: 10000
    })
    expect(adapter.isConnected()).toBe(true)
  })

  it('connects using manual host fields and default database fallback', async () => {
    const { MongoClient } = await import('mongodb')
    const { MongoDBAdapter } = await import('../src/main/db/adapters/mongodb')
    const adapter = new MongoDBAdapter()

    await adapter.connect({
      id: 'mongo-2',
      name: 'Local Mongo',
      type: 'mongodb',
      host: 'localhost',
      port: 27018,
      user: 'root',
      password: 'secret'
    })

    expect(MongoClient).toHaveBeenCalledWith('mongodb://root:secret@localhost:27018/admin', { // betterleaks:allow - test fixture
      serverSelectionTimeoutMS: 10000
    })
  })

  it('lists databases, collections, and inferred top-level fields', async () => {
    const { MongoDBAdapter } = await import('../src/main/db/adapters/mongodb')
    const adapter = new MongoDBAdapter()
    await adapter.connect({ id: 'mongo-3', name: 'Mongo', type: 'mongodb', host: 'localhost' })

    await expect(adapter.getDatabases()).resolves.toEqual(['admin', 'app'])
    await expect(adapter.getTables('app')).resolves.toEqual([
      { name: 'users', type: 'table' },
      { name: 'orders', type: 'table' }
    ])
    await expect(adapter.getColumns('users', 'app')).resolves.toEqual([
      { name: '_id', type: 'object', nullable: false, primaryKey: true },
      { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
      { name: 'createdAt', type: 'date', nullable: false, primaryKey: false },
      { name: 'name', type: 'string', nullable: false, primaryKey: false },
      { name: 'nested', type: 'object', nullable: false, primaryKey: false },
      { name: 'score', type: 'number', nullable: false, primaryKey: false }
    ])
  })

  it('runs find and aggregate queries', async () => {
    const { MongoDBAdapter } = await import('../src/main/db/adapters/mongodb')
    const adapter = new MongoDBAdapter()
    await adapter.connect({ id: 'mongo-4', name: 'Mongo', type: 'mongodb', database: 'app' })

    const findResult = await adapter.query('db.users.find({"active":true}).limit(2)')
    expect(findLimit).toHaveBeenCalledWith(2)
    expect(findResult.rowCount).toBe(2)
    expect(findResult.rows[0]).toMatchObject({ _id: 'abc123', name: 'Ada', active: true })

    const aggregateResult = await adapter.query('db.orders.aggregate([{"$match":{"status":"open"}}])')
    expect(aggregateResult.rows).toEqual([{ status: 'open', total: 2 }])
  })

  it('executes write commands and returns metadata rows', async () => {
    const { MongoDBAdapter } = await import('../src/main/db/adapters/mongodb')
    const adapter = new MongoDBAdapter()
    await adapter.connect({ id: 'mongo-5', name: 'Mongo', type: 'mongodb', database: 'app' })

    const insertResult = await adapter.query('db.users.insertOne({"name":"Ada"})')
    expect(insertOne).toHaveBeenCalledWith({ name: 'Ada' })
    expect(insertResult.rows[0]).toMatchObject({ acknowledged: true, insertedId: 'ins123' })

    const updateResult = await adapter.query('db.users.updateOne({"active":true},{"$set":{"active":false}})')
    expect(updateOne).toHaveBeenCalledWith({ active: true }, { $set: { active: false } }, undefined)
    expect(updateResult.rows[0]).toMatchObject({ matchedCount: 1, modifiedCount: 1 })

    const deleteResult = await adapter.query('db.users.deleteMany({"active":false})')
    expect(deleteMany).toHaveBeenCalledWith({ active: false }, undefined)
    expect(deleteResult.rows[0]).toMatchObject({ deletedCount: 3 })

    const findOneUpdateResult = await adapter.query(
      'db.users.findOneAndUpdate({"name":"Ada"},{"$set":{"active":false}})'
    )
    expect(findOneAndUpdate).toHaveBeenCalled()
    expect(findOneUpdateResult.rows[0]).toMatchObject({ _id: 'abc123', name: 'Ada', active: false })

    const runCommandResult = await adapter.query('db.runCommand({"ping":1})')
    expect(command).toHaveBeenCalledWith({ ping: 1 })
    expect(runCommandResult.rows[0]).toMatchObject({ ok: 1, version: '7.0.4' })
  })

  it('disconnects the Mongo client', async () => {
    const { MongoDBAdapter } = await import('../src/main/db/adapters/mongodb')
    const adapter = new MongoDBAdapter()
    await adapter.connect({ id: 'mongo-6', name: 'Mongo', type: 'mongodb' })

    await adapter.disconnect()

    expect(close).toHaveBeenCalled()
    expect(adapter.isConnected()).toBe(false)
  })
})
