import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { MigrationManager } from '../../../src/main/migration'

describe('MigrationManager', () => {
  let tempDir: string
  let manager: MigrationManager

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobeansql-migration-test-'))
    manager = new MigrationManager(tempDir)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('migrateJson', () => {
    it('should migrate legacy array to versioned object for connections.json', async () => {
      const connectionsPath = path.join(tempDir, 'connections.json')
      const legacyData = [{ id: '1', name: 'Test' }]
      fs.writeFileSync(connectionsPath, JSON.stringify(legacyData))

      await manager.migrateJson('connections.json', [
        { version: 1, up: () => {} }
      ])

      const migrated = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'))
      expect(migrated.version).toBe(1)
      expect(migrated.connections).toEqual(legacyData)
    })

    it('should migrate legacy array to versioned object for saved-queries.json', async () => {
      const queriesPath = path.join(tempDir, 'saved-queries.json')
      const legacyData = [{ id: 'q1', name: 'Query' }]
      fs.writeFileSync(queriesPath, JSON.stringify(legacyData))

      await manager.migrateJson('saved-queries.json', [
        { version: 1, up: () => {} }
      ])

      const migrated = JSON.parse(fs.readFileSync(queriesPath, 'utf-8'))
      expect(migrated.version).toBe(1)
      expect(migrated.queries).toEqual(legacyData)
    })

    it('should apply multiple migration steps', async () => {
      const settingsPath = path.join(tempDir, 'settings.json')
      const initialData = { version: 1, queryLimit: 100 }
      fs.writeFileSync(settingsPath, JSON.stringify(initialData))

      let step2Called = false
      await manager.migrateJson('settings.json', [
        { version: 1, up: () => {} },
        { 
          version: 2, 
          up: () => { step2Called = true } 
        }
      ])

      const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      expect(migrated.version).toBe(2)
      expect(step2Called).toBe(true)
    })
  })

  describe('migrateSqlite', () => {
    it('should apply SQLite migrations and track user_version', async () => {
      // Mock SQLite DB
      const db = {
        pragma: vi.fn().mockImplementation((p) => {
          if (p === 'user_version') return [{ user_version: 0 }]
          if (p.startsWith('user_version =')) {
            const version = parseInt(p.split('=')[1])
            db.pragma.mockImplementation((p2) => {
              if (p2 === 'user_version') return [{ user_version: version }]
              return []
            })
          }
          return []
        })
      }

      let step1Called = false
      await manager.migrateSqlite(db, [
        { version: 1, up: () => { step1Called = true } }
      ])

      expect(step1Called).toBe(true)
      expect(db.pragma).toHaveBeenCalledWith('user_version = 1')
    })

    it('should migrate saved queries from JSON to SQLite in LocalStore', async () => {
      const { LocalStore } = await import('../../../src/main/local-store')
      const store = new LocalStore()
      
      const queriesPath = path.join(tempDir, 'saved-queries.json')
      const legacyData = [{ id: 'q1', name: 'Legacy Query', sql: 'SELECT 1', createdAt: 123 }]
      fs.writeFileSync(queriesPath, JSON.stringify(legacyData))

      // We need to provide a mock DB to the store or use a real temp SQLite
      // For simplicity, let's use a real temp SQLite file
      await store.open(tempDir)
      
      const migrated = store.getSavedQueries()
      expect(migrated).toHaveLength(1)
      expect(migrated[0].name).toBe('Legacy Query')
      expect(migrated[0].id).toBe('q1')
      
      store.close()
    })
  })
})
