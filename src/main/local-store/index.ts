/**
 * LocalStore — SQLite-backed app storage for KobeanSQL.
 *
 * Manages three first-class data sets that benefit from structured,
 * queryable persistence instead of flat JSON files:
 *
 *  • connection_logs  — lifecycle events per connection (connect/disconnect/fail)
 *  • query_history    — every executed query, persisted across sessions
 *  • schema_cache     — serialised DatabaseSchema snapshots per connection+db
 *
 * The database file lives in Electron's userData directory so it is never
 * committed to source control and is isolated per OS user.
 *
 * Usage:
 *   const store = new LocalStore()
 *   store.open(app.getPath('userData'))   // call once at startup
 *   // …use CRUD methods…
 *   store.close()                         // call on app quit
 */

import path from 'path'
import fs from 'fs'
import { appLogger } from '../logger'
import {MigrationManager, MigrationStep} from "../migration";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardLayoutRecord {
  id: string
  name: string
  widgetsJson: string
  updatedAt: number
}

export interface ConnectionLogEntry {
  id: string
  connectionId: string
  connectionName: string
  /** 'connected' | 'disconnected' | 'failed' */
  event: string
  timestamp: number
  error?: string
}

export interface PersistedQueryHistoryEntry {
  id: string
  sql: string
  connectionId: string | null
  connectionName: string
  timestamp: number
  duration: number
  rowCount: number
  error?: string
}

export interface SchemaCacheEntry {
  connectionId: string
  databaseName: string
  schemaJson: string
  cachedAt: number
}

// ---------------------------------------------------------------------------
// Low-level SQLite driver types (mirrors the shape used in the adapter)
// ---------------------------------------------------------------------------

type SqliteRow = Record<string, unknown>

type SqliteStatement = {
  all: (...params: unknown[]) => SqliteRow[]
  run: (...params: unknown[]) => { changes: number }
}

type SqliteDatabase = {
  close: () => void
  prepare: (sql: string) => SqliteStatement
  exec?: (sql: string) => void
  pragma?: (key: string) => unknown
}

// ---------------------------------------------------------------------------
// Helper: open a SQLite database using better-sqlite3 or node:sqlite fallback
// ---------------------------------------------------------------------------

async function openSqliteDatabase(filename: string): Promise<SqliteDatabase> {
  try {
    const mod = await import('better-sqlite3')
    const BetterSqlite3 = mod.default
    return new BetterSqlite3(filename, { readonly: false }) as SqliteDatabase
  } catch {
    const builtinSqlite = (
      process as typeof process & { getBuiltinModule?: (name: string) => unknown }
    ).getBuiltinModule?.('node:sqlite') as { DatabaseSync?: new (p: string) => SqliteDatabase } | undefined
    const DatabaseSync = builtinSqlite?.DatabaseSync
    if (!DatabaseSync) {
      throw new Error('LocalStore: SQLite driver unavailable (better-sqlite3 and node:sqlite both failed)')
    }
    return new DatabaseSync(filename)
  }
}

function execSql(db: SqliteDatabase, sql: string): void {
  if (db.exec) {
    db.exec(sql)
  } else {
    // node:sqlite fallback — split on ';' and run each statement via prepare
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      db.prepare(stmt).run()
    }
  }
}

function applyPragma(db: SqliteDatabase, pragma: string): void {
  if (db.pragma) {
    db.pragma(pragma)
  } else {
    execSql(db, `PRAGMA ${pragma}`)
  }
}

// ---------------------------------------------------------------------------
// Schema DDL (Legacy / Initial)
// ---------------------------------------------------------------------------

const INITIAL_DDL = `
CREATE TABLE IF NOT EXISTS connection_logs (
  id               TEXT    PRIMARY KEY,
  connection_id    TEXT    NOT NULL,
  connection_name  TEXT    NOT NULL,
  event            TEXT    NOT NULL,
  timestamp        INTEGER NOT NULL,
  error            TEXT
);

CREATE INDEX IF NOT EXISTS idx_connection_logs_ts
  ON connection_logs (timestamp DESC);

CREATE TABLE IF NOT EXISTS query_history (
  id               TEXT    PRIMARY KEY,
  sql              TEXT    NOT NULL,
  connection_id    TEXT,
  connection_name  TEXT    NOT NULL,
  timestamp        INTEGER NOT NULL,
  duration         INTEGER NOT NULL,
  row_count        INTEGER NOT NULL,
  error            TEXT
);

CREATE INDEX IF NOT EXISTS idx_query_history_ts
  ON query_history (timestamp DESC);

CREATE TABLE IF NOT EXISTS schema_cache (
  connection_id  TEXT    NOT NULL,
  database_name  TEXT    NOT NULL,
  schema_json    TEXT    NOT NULL,
  cached_at      INTEGER NOT NULL,
  PRIMARY KEY (connection_id, database_name)
);

CREATE TABLE IF NOT EXISTS saved_queries (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  sql         TEXT    NOT NULL,
  category    TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_name
  ON saved_queries (name);
`

// Maximum number of query history rows kept in the database
const MAX_HISTORY_ROWS = 500

// ---------------------------------------------------------------------------
// LocalStore class
// ---------------------------------------------------------------------------

export class LocalStore {
  private db: SqliteDatabase | null = null
  private migrationManager: MigrationManager | null = null

  /**
   * Open (or create) the local store database.
   * Must be called once during app startup before any other method.
   *
   * @param userDataDir  Value of `app.getPath('userData')`
   */
  async open(userDataDir: string): Promise<void> {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      const dbPath = path.join(userDataDir, 'kobeansql-storage.db')
      this.db = await openSqliteDatabase(dbPath)
      this.migrationManager = new MigrationManager(userDataDir)

      applyPragma(this.db, 'journal_mode = WAL')
      applyPragma(this.db, 'foreign_keys = ON')
      
      // Run initial DDL (safe because of IF NOT EXISTS)
      execSql(this.db, INITIAL_DDL)

      // Define migrations here
      const migrations: MigrationStep[] = [
        {
          version: 1,
          up: () => {
            // Version 1 is the baseline schema created by INITIAL_DDL.
          }
        },
        {
          version: 2,
          up: async () => {
            execSql(this.db!, `
              CREATE TABLE IF NOT EXISTS dashboard_layouts (
                id          TEXT    PRIMARY KEY,
                name        TEXT    NOT NULL,
                widgets_json TEXT   NOT NULL,
                updated_at  INTEGER NOT NULL
              );
            `)
          }
        },
        {
          version: 3,
          up: async () => {
            const jsonPath = path.join(userDataDir, 'saved-queries.json')
            if (fs.existsSync(jsonPath)) {
              try {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
                const queries = Array.isArray(data) ? data : (data.queries ?? [])
                for (const q of queries) {
                  this.addSavedQuery({
                    id: q.id,
                    name: q.name,
                    sql: q.sql,
                    category: q.category,
                    createdAt: q.createdAt || Date.now()
                  })
                }
                appLogger.info(`Migrated ${queries.length} saved queries to SQLite`)
                // We keep the JSON for now but it won't be used anymore.
                // Optionally rename it: fs.renameSync(jsonPath, jsonPath + '.bak')
              } catch (err) {
                appLogger.error('Failed to migrate saved queries from JSON', { error: (err as Error).message })
              }
            }
          }
        }
      ]

      await this.migrationManager.migrateSqlite(this.db, migrations)
      
      appLogger.info('LocalStore opened and migrated', { dbPath })
    } catch (err) {
      appLogger.error('LocalStore failed to open or migrate', { error: (err as Error).message })
      // Non-fatal — the rest of the app can continue with degraded persistence.
      this.db = null
    }
  }

  /** Close the database. Call on app quit. */
  close(): void {
    try {
      this.db?.close()
    } catch {/* ignore */}
    this.db = null
  }

  // -------------------------------------------------------------------------
  // Connection logs
  // -------------------------------------------------------------------------

  addConnectionLog(entry: ConnectionLogEntry): void {
    if (!this.db) return
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO connection_logs
             (id, connection_id, connection_name, event, timestamp, error)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.id,
          entry.connectionId,
          entry.connectionName,
          entry.event,
          entry.timestamp,
          entry.error ?? null
        )
    } catch (err) {
      appLogger.error('LocalStore.addConnectionLog failed', { error: (err as Error).message })
    }
  }

  getConnectionLogs(connectionId?: string, limit = 100): ConnectionLogEntry[] {
    if (!this.db) return []
    try {
      const rows = connectionId
        ? this.db
            .prepare(
              `SELECT id, connection_id, connection_name, event, timestamp, error
               FROM connection_logs WHERE connection_id = ?
               ORDER BY timestamp DESC LIMIT ?`
            )
            .all(connectionId, limit)
        : this.db
            .prepare(
              `SELECT id, connection_id, connection_name, event, timestamp, error
               FROM connection_logs ORDER BY timestamp DESC LIMIT ?`
            )
            .all(limit)

      return rows.map(rowToConnectionLog)
    } catch (err) {
      appLogger.error('LocalStore.getConnectionLogs failed', { error: (err as Error).message })
      return []
    }
  }

  clearConnectionLogs(connectionId?: string): void {
    if (!this.db) return
    try {
      if (connectionId) {
        this.db.prepare('DELETE FROM connection_logs WHERE connection_id = ?').run(connectionId)
      } else {
        this.db.prepare('DELETE FROM connection_logs').run()
      }
    } catch (err) {
      appLogger.error('LocalStore.clearConnectionLogs failed', { error: (err as Error).message })
    }
  }

  // -------------------------------------------------------------------------
  // Query history
  // -------------------------------------------------------------------------

  addQueryHistory(entry: PersistedQueryHistoryEntry): void {
    if (!this.db) return
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO query_history
             (id, sql, connection_id, connection_name, timestamp, duration, row_count, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.id,
          entry.sql,
          entry.connectionId ?? null,
          entry.connectionName,
          entry.timestamp,
          entry.duration,
          entry.rowCount,
          entry.error ?? null
        )
      // Keep the table bounded
      this.db
        .prepare(
          `DELETE FROM query_history WHERE id IN (
             SELECT id FROM query_history ORDER BY timestamp DESC LIMIT -1 OFFSET ?
           )`
        )
        .run(MAX_HISTORY_ROWS)
    } catch (err) {
      appLogger.error('LocalStore.addQueryHistory failed', { error: (err as Error).message })
    }
  }

  getQueryHistory(limit = 200): PersistedQueryHistoryEntry[] {
    if (!this.db) return []
    try {
      const rows = this.db
        .prepare(
          `SELECT id, sql, connection_id, connection_name, timestamp, duration, row_count, error
           FROM query_history ORDER BY timestamp DESC LIMIT ?`
        )
        .all(limit)
      return rows.map(rowToHistoryEntry)
    } catch (err) {
      appLogger.error('LocalStore.getQueryHistory failed', { error: (err as Error).message })
      return []
    }
  }

  clearQueryHistory(): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM query_history').run()
    } catch (err) {
      appLogger.error('LocalStore.clearQueryHistory failed', { error: (err as Error).message })
    }
  }

  // -------------------------------------------------------------------------
  // Schema cache
  // -------------------------------------------------------------------------

  setSchemaCache(connectionId: string, databaseName: string, schemaJson: string): void {
    if (!this.db) return
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO schema_cache
             (connection_id, database_name, schema_json, cached_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(connectionId, databaseName, schemaJson, Date.now())
    } catch (err) {
      appLogger.error('LocalStore.setSchemaCache failed', { error: (err as Error).message })
    }
  }

  getSchemaCache(connectionId: string, databaseName: string): SchemaCacheEntry | null {
    if (!this.db) return null
    try {
      const rows = this.db
        .prepare(
          `SELECT connection_id, database_name, schema_json, cached_at
           FROM schema_cache WHERE connection_id = ? AND database_name = ?`
        )
        .all(connectionId, databaseName)
      if (rows.length === 0) return null
      return rowToSchemaCacheEntry(rows[0])
    } catch (err) {
      appLogger.error('LocalStore.getSchemaCache failed', { error: (err as Error).message })
      return null
    }
  }

  clearSchemaCache(connectionId?: string): void {
    if (!this.db) return
    try {
      if (connectionId) {
        this.db.prepare('DELETE FROM schema_cache WHERE connection_id = ?').run(connectionId)
      } else {
        this.db.prepare('DELETE FROM schema_cache').run()
      }
    } catch (err) {
      appLogger.error('LocalStore.clearSchemaCache failed', { error: (err as Error).message })
    }
  }

  // -------------------------------------------------------------------------
  // Saved queries
  // -------------------------------------------------------------------------

  addSavedQuery(query: { id: string; name: string; sql: string; category?: string; createdAt: number }): void {
    if (!this.db) return
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO saved_queries
             (id, name, sql, category, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(query.id, query.name, query.sql, query.category ?? null, query.createdAt)
    } catch (err) {
      appLogger.error('LocalStore.addSavedQuery failed', { error: (err as Error).message })
    }
  }

  getSavedQueries(): { id: string; name: string; sql: string; category?: string; createdAt: number }[] {
    if (!this.db) return []
    try {
      const rows = this.db
        .prepare('SELECT id, name, sql, category, created_at FROM saved_queries ORDER BY created_at DESC')
        .all()
      return rows.map((row) => ({
        id: String(row['id']),
        name: String(row['name']),
        sql: String(row['sql']),
        category: row['category'] ? String(row['category']) : undefined,
        createdAt: Number(row['created_at'])
      }))
    } catch (err) {
      appLogger.error('LocalStore.getSavedQueries failed', { error: (err as Error).message })
      return []
    }
  }

  deleteSavedQuery(id: string): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM saved_queries WHERE id = ?').run(id)
    } catch (err) {
      appLogger.error('LocalStore.deleteSavedQuery failed', { error: (err as Error).message })
    }
  }

  // -------------------------------------------------------------------------
  // Dashboard layouts
  // -------------------------------------------------------------------------

  getDashboardLayouts(): DashboardLayoutRecord[] {
    if (!this.db) return []
    try {
      const rows = this.db
        .prepare('SELECT id, name, widgets_json, updated_at FROM dashboard_layouts ORDER BY updated_at DESC')
        .all()
      return rows.map(rowToDashboardLayout)
    } catch (err) {
      appLogger.error('LocalStore.getDashboardLayouts failed', { error: (err as Error).message })
      return []
    }
  }

  saveDashboardLayout(layout: DashboardLayoutRecord): void {
    if (!this.db) return
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO dashboard_layouts (id, name, widgets_json, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(layout.id, layout.name, layout.widgetsJson, layout.updatedAt)
    } catch (err) {
      appLogger.error('LocalStore.saveDashboardLayout failed', { error: (err as Error).message })
    }
  }

  deleteDashboardLayout(id: string): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM dashboard_layouts WHERE id = ?').run(id)
    } catch (err) {
      appLogger.error('LocalStore.deleteDashboardLayout failed', { error: (err as Error).message })
    }
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToConnectionLog(row: SqliteRow): ConnectionLogEntry {
  return {
    id: String(row['id'] ?? ''),
    connectionId: String(row['connection_id'] ?? ''),
    connectionName: String(row['connection_name'] ?? ''),
    event: String(row['event'] ?? ''),
    timestamp: Number(row['timestamp'] ?? 0),
    error: row['error'] != null ? String(row['error']) : undefined
  }
}

function rowToHistoryEntry(row: SqliteRow): PersistedQueryHistoryEntry {
  return {
    id: String(row['id'] ?? ''),
    sql: String(row['sql'] ?? ''),
    connectionId: row['connection_id'] != null ? String(row['connection_id']) : null,
    connectionName: String(row['connection_name'] ?? ''),
    timestamp: Number(row['timestamp'] ?? 0),
    duration: Number(row['duration'] ?? 0),
    rowCount: Number(row['row_count'] ?? 0),
    error: row['error'] != null ? String(row['error']) : undefined
  }
}

function rowToSchemaCacheEntry(row: SqliteRow): SchemaCacheEntry {
  return {
    connectionId: String(row['connection_id'] ?? ''),
    databaseName: String(row['database_name'] ?? ''),
    schemaJson: String(row['schema_json'] ?? '{}'),
    cachedAt: Number(row['cached_at'] ?? 0)
  }
}

function rowToDashboardLayout(row: SqliteRow): DashboardLayoutRecord {
  return {
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    widgetsJson: String(row['widgets_json'] ?? '[]'),
    updatedAt: Number(row['updated_at'] ?? 0)
  }
}

// ---------------------------------------------------------------------------
// Singleton instance shared across the main process
// ---------------------------------------------------------------------------

export const localStore = new LocalStore()
