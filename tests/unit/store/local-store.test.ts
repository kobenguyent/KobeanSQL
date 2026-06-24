import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { LocalStore } from '../../../src/main/local-store'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kobeansql-local-store-test-'))
}

function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalStore', () => {
  let store: LocalStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = createTmpDir()
    store = new LocalStore()
    await store.open(tmpDir)
  })

  afterEach(() => {
    store.close()
    removeTmpDir(tmpDir)
  })

  // -------------------------------------------------------------------------
  // Connection logs
  // -------------------------------------------------------------------------

  describe('connection logs', () => {
    it('returns an empty array when no logs have been added', () => {
      expect(store.getConnectionLogs()).toEqual([])
    })

    it('stores and retrieves a connection log', () => {
      store.addConnectionLog({
        id: 'log-1',
        connectionId: 'conn-a',
        connectionName: 'My DB',
        event: 'connected',
        timestamp: 1000
      })

      const logs = store.getConnectionLogs()
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        id: 'log-1',
        connectionId: 'conn-a',
        connectionName: 'My DB',
        event: 'connected',
        timestamp: 1000,
        error: undefined
      })
    })

    it('stores a log with an error field', () => {
      store.addConnectionLog({
        id: 'log-err',
        connectionId: 'conn-b',
        connectionName: 'Broken DB',
        event: 'failed',
        timestamp: 2000,
        error: 'ECONNREFUSED'
      })

      const logs = store.getConnectionLogs()
      expect(logs[0]?.error).toBe('ECONNREFUSED')
    })

    it('filters logs by connectionId', () => {
      store.addConnectionLog({ id: 'l1', connectionId: 'c1', connectionName: 'A', event: 'connected', timestamp: 1 })
      store.addConnectionLog({ id: 'l2', connectionId: 'c2', connectionName: 'B', event: 'connected', timestamp: 2 })

      const forC1 = store.getConnectionLogs('c1')
      expect(forC1).toHaveLength(1)
      expect(forC1[0]?.connectionId).toBe('c1')
    })

    it('clears all logs', () => {
      store.addConnectionLog({ id: 'l1', connectionId: 'c1', connectionName: 'A', event: 'connected', timestamp: 1 })
      store.addConnectionLog({ id: 'l2', connectionId: 'c2', connectionName: 'B', event: 'connected', timestamp: 2 })
      store.clearConnectionLogs()
      expect(store.getConnectionLogs()).toHaveLength(0)
    })

    it('clears logs for a specific connection only', () => {
      store.addConnectionLog({ id: 'l1', connectionId: 'c1', connectionName: 'A', event: 'connected', timestamp: 1 })
      store.addConnectionLog({ id: 'l2', connectionId: 'c2', connectionName: 'B', event: 'connected', timestamp: 2 })
      store.clearConnectionLogs('c1')

      const remaining = store.getConnectionLogs()
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.connectionId).toBe('c2')
    })

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        store.addConnectionLog({
          id: `l${i}`,
          connectionId: 'c',
          connectionName: 'C',
          event: 'connected',
          timestamp: i
        })
      }
      const limited = store.getConnectionLogs(undefined, 3)
      expect(limited).toHaveLength(3)
    })

    it('returns logs in descending timestamp order', () => {
      store.addConnectionLog({ id: 'la', connectionId: 'c', connectionName: 'C', event: 'connected', timestamp: 100 })
      store.addConnectionLog({ id: 'lb', connectionId: 'c', connectionName: 'C', event: 'connected', timestamp: 200 })

      const logs = store.getConnectionLogs()
      expect(logs[0]?.timestamp).toBeGreaterThan(logs[1]?.timestamp ?? 0)
    })
  })

  // -------------------------------------------------------------------------
  // Query history
  // -------------------------------------------------------------------------

  describe('query history', () => {
    it('returns an empty array when no history exists', () => {
      expect(store.getQueryHistory()).toEqual([])
    })

    it('stores and retrieves a history entry', () => {
      store.addQueryHistory({
        id: 'h1',
        sql: 'SELECT 1',
        connectionId: 'conn-a',
        connectionName: 'My DB',
        timestamp: 5000,
        duration: 12,
        rowCount: 1
      })

      const history = store.getQueryHistory()
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        id: 'h1',
        sql: 'SELECT 1',
        connectionId: 'conn-a',
        connectionName: 'My DB',
        timestamp: 5000,
        duration: 12,
        rowCount: 1,
        error: undefined
      })
    })

    it('stores a history entry with a null connectionId', () => {
      store.addQueryHistory({
        id: 'h-null',
        sql: 'SELECT 42',
        connectionId: null,
        connectionName: 'Unknown',
        timestamp: 1,
        duration: 5,
        rowCount: 0
      })

      const history = store.getQueryHistory()
      expect(history[0]?.connectionId).toBeNull()
    })

    it('stores a history entry with an error', () => {
      store.addQueryHistory({
        id: 'h-err',
        sql: 'SELEC BROK',
        connectionId: 'c',
        connectionName: 'X',
        timestamp: 1,
        duration: 0,
        rowCount: 0,
        error: 'syntax error'
      })

      expect(store.getQueryHistory()[0]?.error).toBe('syntax error')
    })

    it('respects the limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        store.addQueryHistory({
          id: `h${i}`,
          sql: `SELECT ${i}`,
          connectionId: 'c',
          connectionName: 'C',
          timestamp: i,
          duration: 1,
          rowCount: 1
        })
      }
      const limited = store.getQueryHistory(5)
      expect(limited).toHaveLength(5)
    })

    it('returns history in descending timestamp order', () => {
      store.addQueryHistory({ id: 'ha', sql: 'A', connectionId: null, connectionName: 'X', timestamp: 100, duration: 1, rowCount: 0 })
      store.addQueryHistory({ id: 'hb', sql: 'B', connectionId: null, connectionName: 'X', timestamp: 200, duration: 1, rowCount: 0 })

      const history = store.getQueryHistory()
      expect(history[0]?.timestamp).toBeGreaterThan(history[1]?.timestamp ?? 0)
    })

    it('clears all query history', () => {
      store.addQueryHistory({ id: 'h1', sql: 'S', connectionId: null, connectionName: 'X', timestamp: 1, duration: 1, rowCount: 0 })
      store.clearQueryHistory()
      expect(store.getQueryHistory()).toHaveLength(0)
    })

    it('upserts a history entry with the same id', () => {
      store.addQueryHistory({ id: 'same', sql: 'SELECT 1', connectionId: null, connectionName: 'X', timestamp: 1, duration: 1, rowCount: 1 })
      store.addQueryHistory({ id: 'same', sql: 'SELECT 2', connectionId: null, connectionName: 'X', timestamp: 2, duration: 2, rowCount: 2 })

      const history = store.getQueryHistory()
      expect(history).toHaveLength(1)
      expect(history[0]?.sql).toBe('SELECT 2')
    })
  })

  // -------------------------------------------------------------------------
  // Schema cache
  // -------------------------------------------------------------------------

  describe('schema cache', () => {
    it('returns null when no cache entry exists', () => {
      expect(store.getSchemaCache('c1', 'mydb')).toBeNull()
    })

    it('stores and retrieves a schema cache entry', () => {
      const schema = JSON.stringify({ tables: [], relationships: [] })
      store.setSchemaCache('c1', 'mydb', schema)

      const entry = store.getSchemaCache('c1', 'mydb')
      expect(entry).not.toBeNull()
      expect(entry?.connectionId).toBe('c1')
      expect(entry?.databaseName).toBe('mydb')
      expect(entry?.schemaJson).toBe(schema)
      expect(typeof entry?.cachedAt).toBe('number')
      expect(entry?.cachedAt).toBeGreaterThan(0)
    })

    it('overwrites an existing cache entry', () => {
      store.setSchemaCache('c1', 'mydb', '{"v":1}')
      store.setSchemaCache('c1', 'mydb', '{"v":2}')

      const entry = store.getSchemaCache('c1', 'mydb')
      expect(entry?.schemaJson).toBe('{"v":2}')
    })

    it('returns null for a different database name on the same connection', () => {
      store.setSchemaCache('c1', 'mydb', '{}')
      expect(store.getSchemaCache('c1', 'otherdb')).toBeNull()
    })

    it('clears schema cache for a specific connection', () => {
      store.setSchemaCache('c1', 'db', '{}')
      store.setSchemaCache('c2', 'db', '{}')
      store.clearSchemaCache('c1')

      expect(store.getSchemaCache('c1', 'db')).toBeNull()
      expect(store.getSchemaCache('c2', 'db')).not.toBeNull()
    })

    it('clears all schema caches', () => {
      store.setSchemaCache('c1', 'db1', '{}')
      store.setSchemaCache('c2', 'db2', '{}')
      store.clearSchemaCache()

      expect(store.getSchemaCache('c1', 'db1')).toBeNull()
      expect(store.getSchemaCache('c2', 'db2')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Graceful degradation
  // -------------------------------------------------------------------------

  describe('graceful degradation when db is closed', () => {
    it('does not throw when methods are called after close()', () => {
      store.close()

      expect(() => store.addConnectionLog({ id: 'x', connectionId: 'c', connectionName: 'C', event: 'connected', timestamp: 1 })).not.toThrow()
      expect(store.getConnectionLogs()).toEqual([])
      expect(() => store.clearConnectionLogs()).not.toThrow()

      expect(() => store.addQueryHistory({ id: 'y', sql: 'S', connectionId: null, connectionName: 'X', timestamp: 1, duration: 1, rowCount: 0 })).not.toThrow()
      expect(store.getQueryHistory()).toEqual([])
      expect(() => store.clearQueryHistory()).not.toThrow()

      expect(() => store.setSchemaCache('c', 'd', '{}')).not.toThrow()
      expect(store.getSchemaCache('c', 'd')).toBeNull()
      expect(() => store.clearSchemaCache()).not.toThrow()
    })
  })
})
