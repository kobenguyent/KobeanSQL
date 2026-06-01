import { ObjectId } from 'mongodb'
import { describe, expect, it } from 'vitest'
import { parseMongoOperation } from '../src/main/db/adapters/mongodb'

describe('mongodb query parser', () => {
  it('parses find with filter and projection', () => {
    const parsed = parseMongoOperation('db.users.find({"active":true},{"email":1})')

    expect(parsed).toEqual({
      kind: 'find',
      collection: 'users',
      filter: { active: true },
      projection: { email: 1 }
    })
  })

  it('parses find with a limit chain', () => {
    const parsed = parseMongoOperation('db.users.find({"active":true}).limit(25)')

    expect(parsed).toEqual({
      kind: 'find',
      collection: 'users',
      filter: { active: true },
      projection: undefined,
      limit: 25
    })
  })

  it('parses aggregate pipeline', () => {
    const parsed = parseMongoOperation('db.orders.aggregate([{"$match":{"status":"open"}},{"$limit":5}])')

    expect(parsed.kind).toBe('aggregate')
    if (parsed.kind !== 'aggregate') return
    expect(parsed.collection).toBe('orders')
    expect(parsed.pipeline).toHaveLength(2)
  })

  it('rejects malformed JSON arguments', () => {
    expect(() => parseMongoOperation('db.users.find({active:true})')).toThrow('MongoDB query arguments must be valid JSON')
  })

  it('parses writable collection commands', () => {
    const updateParsed = parseMongoOperation(
      'db.getCollection("users").updateOne({"_id":{"$oid":"507f191e810c19729de860ea"}},{"$set":{"active":false}})'
    )
    expect(updateParsed).toEqual({
      kind: 'collectionCommand',
      collection: 'users',
      method: 'updateOne',
      args: [
        { _id: new ObjectId('507f191e810c19729de860ea') },
        { $set: { active: false } }
      ]
    })

    const insertParsed = parseMongoOperation('db.users.insertOne({"name":"Ada"})')
    expect(insertParsed).toEqual({
      kind: 'collectionCommand',
      collection: 'users',
      method: 'insertOne',
      args: [{ name: 'Ada' }]
    })
  })

  it('parses db.runCommand payloads', () => {
    const parsed = parseMongoOperation('db.runCommand({"ping":1})')

    expect(parsed).toEqual({
      kind: 'runCommand',
      command: { ping: 1 }
    })
  })

  it('rejects unsupported syntax', () => {
    expect(() => parseMongoOperation('db.users.distinct("email")')).toThrow('Unsupported MongoDB query.')
  })
})
