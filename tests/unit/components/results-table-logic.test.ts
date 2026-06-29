import { describe, expect, it } from 'vitest'
import {
  buildBulkDeleteRowMutationRequests,
  quoteIdentifierForDb,
  quoteValueForDb,
  buildInlineUpdateSql,
  buildDeleteSql,
  buildDeleteRowMutationRequest,
  buildDuplicateRowMutationRequest,
  buildInsertRowMutationRequest,
  buildInlineUpdateMongoQuery,
  buildDeleteMongoQuery,
  buildMongoPkFilter,
  getResultsTableActionAvailability
} from '../../../src/renderer/src/components/ResultsTable'
import {
  buildInsertSql as buildMainInsertSql,
  buildDeleteSql as buildMainDeleteSql,
  buildDuplicateSql as buildMainDuplicateSql
} from '../../../src/main/db/mutations/sql-row-mutations'
import { buildSelectTableSql } from '../../../src/renderer/src/sql/dsl'

describe('ResultsTable Logic', () => {
  describe('quoteIdentifierForDb', () => {
    it('quotes identifiers correctly for different dialects', () => {
      expect(quoteIdentifierForDb('table', 'mssql')).toBe('[table]')
      expect(quoteIdentifierForDb('table', 'mysql')).toBe('`table`')
      expect(quoteIdentifierForDb('table', 'postgres')).toBe('"table"')
      expect(quoteIdentifierForDb('table')).toBe('"table"')
    })

    it('escapes closing brackets/backticks/quotes', () => {
      expect(quoteIdentifierForDb('my]table', 'mssql')).toBe('[my]]table]')
      expect(quoteIdentifierForDb('my`table', 'mysql')).toBe('`my``table`')
      expect(quoteIdentifierForDb('my"table', 'postgres')).toBe('"my""table"')
    })
  })

  describe('quoteValueForDb', () => {
    it('quotes values correctly', () => {
      expect(quoteValueForDb(null)).toBe('NULL')
      expect(quoteValueForDb(123)).toBe('123')
      expect(quoteValueForDb(true, 'postgres')).toBe('TRUE')
      expect(quoteValueForDb(true, 'mssql')).toBe('1')
      expect(quoteValueForDb('hello')).toBe("'hello'")
      expect(quoteValueForDb("it's")).toBe("'it''s'")
    })

    it('escapes backslashes in mysql/mariadb', () => {
      expect(quoteValueForDb('path\\to', 'mysql')).toBe("'path\\\\to'")
      expect(quoteValueForDb('path\\to', 'postgres')).toBe("'path\\to'")
    })
  })

  describe('SQL Builders', () => {
    const pk = [{ name: 'id', primaryKey: true }] as any
    const row = { id: 1, name: 'kobe' }

    it('builds UPDATE SQL', () => {
      const sql = buildInlineUpdateSql(row, 'name', 'new_name', pk, 'users', undefined, undefined, 'postgres')
      expect(sql).toContain('UPDATE "users"')
      expect(sql).toContain('SET "name" = \'new_name\'')
      expect(sql).toContain('WHERE "id" = 1')
    })

    it('builds DELETE SQL', () => {
      const sql = buildDeleteSql(row, pk, 'users', undefined, undefined, 'postgres')
      expect(sql).toContain('DELETE FROM "users"')
      expect(sql).toContain('WHERE "id" = 1')
    })

    it('returns null if no PK columns provided', () => {
      expect(buildInlineUpdateSql(row, 'name', 'new_name', [], 'users')).toBeNull()
      expect(buildDeleteSql(row, [], 'users')).toBeNull()
    })
  })

  describe('Main-process SQL mutation builders', () => {
    const target = {
      tableName: 'users',
      database: 'app',
      schema: 'public',
      databaseType: 'postgres'
    } as const
    const pk = [{ name: 'id', type: 'int4', nullable: false, primaryKey: true }] as const
    const row = { id: 1, name: "Ada's" }

    it('builds INSERT SQL with the same qualifier and quoting rules as the renderer', () => {
      expect(buildMainInsertSql(target, row)).toBe(
        `INSERT INTO "public"."users" ("id", "name") VALUES (1, 'Ada''s');`
      )
    })

    it('builds DELETE SQL matching the renderer helper output', () => {
      const rendererSql = buildDeleteSql(row, [...pk], target.tableName, target.database, target.schema, target.databaseType)
      expect(buildMainDeleteSql(target, [...pk], row)).toBe(rendererSql?.replace('\n', ' '))
    })

    it('builds duplicate INSERT SQL without primary-key columns', () => {
      expect(buildMainDuplicateSql(target, row, [...pk])).toBe(
        `INSERT INTO "public"."users" ("name") VALUES ('Ada''s');`
      )
    })

    it('returns null for invalid empty delete and duplicate mutation shapes', () => {
      expect(buildMainDeleteSql(target, [], row)).toBeNull()
      expect(buildMainDuplicateSql(target, { id: 1 }, [...pk])).toBeNull()
    })

    it('returns null for inserts with no columns to write', () => {
      expect(buildMainInsertSql(target, {})).toBeNull()
    })
  })

  describe('row mutation payload builders', () => {
    const pk = [{ name: 'id', type: 'int4', nullable: false, primaryKey: true }] as const
    const row = { id: 1, name: 'Ada' }

    it('builds insert payloads with the live renderer context', () => {
      expect(
        buildInsertRowMutationRequest({
          connectionId: 'pg-1',
          tableName: 'users',
          database: 'app',
          schema: 'public',
          databaseType: 'postgres',
          rowData: row
        })
      ).toEqual({
        connectionId: 'pg-1',
        tableName: 'users',
        database: 'app',
        schema: 'public',
        databaseType: 'postgres',
        rowData: row
      })
    })

    it('builds delete payloads with primary-key metadata and row data', () => {
      expect(
        buildDeleteRowMutationRequest({
          connectionId: 'pg-1',
          tableName: 'users',
          database: 'app',
          schema: 'public',
          databaseType: 'postgres',
          pkColumns: [...pk],
          rowData: {
            _tempId: 'row-1',
            ...row
          }
        })
      ).toEqual({
        connectionId: 'pg-1',
        tableName: 'users',
        database: 'app',
        schema: 'public',
        databaseType: 'postgres',
        pkColumns: [...pk],
        rowData: row
      })
    })

    it('builds duplicate payloads with the same identifying metadata as delete', () => {
      expect(
        buildDuplicateRowMutationRequest({
          connectionId: 'pg-1',
          tableName: 'users',
          database: 'app',
          schema: 'public',
          databaseType: 'postgres',
          pkColumns: [...pk],
          rowData: row
        })
      ).toEqual({
        connectionId: 'pg-1',
        tableName: 'users',
        database: 'app',
        schema: 'public',
        databaseType: 'postgres',
        pkColumns: [...pk],
        rowData: row
      })
    })

    it('strips renderer-only row metadata before building duplicate payloads', () => {
      expect(
        buildDuplicateRowMutationRequest({
          connectionId: 'pg-1',
          tableName: 'users',
          database: 'app',
          schema: 'public',
          databaseType: 'postgres',
          pkColumns: [...pk],
          rowData: {
            _tempId: 'row-1',
            ...row
          }
        })
      ).toEqual({
        connectionId: 'pg-1',
        tableName: 'users',
        database: 'app',
        schema: 'public',
        databaseType: 'postgres',
        pkColumns: [...pk],
        rowData: row
      })
    })

    it('builds one structured delete request per selected row for bulk deletes', () => {
      expect(
        buildBulkDeleteRowMutationRequests({
          connectionId: 'pg-1',
          tableName: 'users',
          database: 'app',
          schema: 'public',
          databaseType: 'postgres',
          pkColumns: [...pk],
          rows: [
            { _tempId: 'row-1', id: 1, name: 'Ada' },
            { _tempId: 'row-2', id: 2, name: 'Grace' }
          ]
        })
      ).toEqual([
        {
          connectionId: 'pg-1',
          tableName: 'users',
          database: 'app',
          schema: 'public',
          databaseType: 'postgres',
          pkColumns: [...pk],
          rowData: { id: 1, name: 'Ada' }
        },
        {
          connectionId: 'pg-1',
          tableName: 'users',
          database: 'app',
          schema: 'public',
          databaseType: 'postgres',
          pkColumns: [...pk],
          rowData: { id: 2, name: 'Grace' }
        }
      ])
    })
  })

  describe('capability gating', () => {
    it('enables only the row actions allowed by the active connection capabilities', () => {
      expect(
        getResultsTableActionAvailability({
          hasMutationContext: true,
          hasPrimaryKey: true,
          capabilities: {
            canInsertRow: true,
            canDeleteRow: false,
            canDuplicateRow: true,
            canInlineUpdateRow: false,
            canCopyTable: false,
            canManageSchema: false,
            supportsForeignKeys: false,
            supportsProcedures: false
          }
        })
      ).toEqual({
        canInsertRow: true,
        canDeleteRow: false,
        canDuplicateRow: true,
        canInlineUpdateRow: false,
        canShowRowActions: true,
        canBulkDelete: false
      })
    })

    it('disables mutation affordances when there is no active table mutation context', () => {
      expect(
        getResultsTableActionAvailability({
          hasMutationContext: false,
          hasPrimaryKey: true,
          capabilities: {
            canInsertRow: true,
            canDeleteRow: true,
            canDuplicateRow: true,
            canInlineUpdateRow: true,
            canCopyTable: false,
            canManageSchema: false,
            supportsForeignKeys: false,
            supportsProcedures: false
          }
        })
      ).toEqual({
        canInsertRow: false,
        canDeleteRow: false,
        canDuplicateRow: false,
        canInlineUpdateRow: false,
        canShowRowActions: false,
        canBulkDelete: false
      })
    })
  })

  describe('buildSelectTableSql', () => {
    it('builds basic SELECT', () => {
      const sql = buildSelectTableSql('postgres', 'users', 'public', 100)
      expect(sql).toBe('SELECT * FROM "public"."users" LIMIT 100;')
    })

    it('builds SELECT with WHERE clause', () => {
      const sql = buildSelectTableSql('postgres', 'users', 'public', 100, { column: 'id', value: 123 })
      expect(sql).toContain('WHERE "id" = 123')
    })

    it('quotes string values in WHERE clause', () => {
      const sql = buildSelectTableSql('postgres', 'users', undefined, 100, { column: 'name', value: "kobe's" })
      expect(sql).toContain("WHERE \"name\" = 'kobe''s'")
    })

    it('handles boolean values in WHERE clause by dialect', () => {
      const pgSql = buildSelectTableSql('postgres', 'users', undefined, 10, { column: 'active', value: true })
      expect(pgSql).toContain('WHERE "active" = TRUE')

      const mssqlSql = buildSelectTableSql('mssql', 'users', undefined, 10, { column: 'active', value: true })
      expect(mssqlSql).toContain('WHERE [active] = 1')
    })

    it('builds MongoDB find with filter', () => {
      const query = buildSelectTableSql('mongodb', 'users', undefined, 50, { column: 'dept', value: 'sales' })
      expect(query).toBe('db.users.find({"dept":"sales"}).limit(50)')
    })
  })

  describe('MongoDB Builders', () => {
    const pk = [{ name: '_id', primaryKey: true }] as any
    const row = { _id: '60a5f...', name: 'kobe' }

    it('builds MongoDB PK filter', () => {
      const filter = buildMongoPkFilter(row, pk)
      expect(filter).toEqual({ _id: '60a5f...' })
    })

    it('handles ObjectId-like strings in PK filter', () => {
      const oidRow = { _id: '507f1f77bcf86cd799439011' }
      const filter = buildMongoPkFilter(oidRow, pk) as any
      expect(filter.$or).toBeDefined()
      expect(filter.$or).toContainEqual({ _id: '507f1f77bcf86cd799439011' })
      expect(filter.$or).toContainEqual({ _id: { $oid: '507f1f77bcf86cd799439011' } })
    })

    it('builds MongoDB UPDATE query', () => {
      const query = buildInlineUpdateMongoQuery(row, 'name', 'new_name', pk, 'users')
      expect(query).toContain('db.getCollection("users").updateOne')
      expect(query).toContain('"$set":{"name":"new_name"}')
    })

    it('builds MongoDB DELETE query', () => {
      const query = buildDeleteMongoQuery(row, pk, 'users')
      expect(query).toContain('db.getCollection("users").deleteOne')
      expect(query).toContain('"_id":"60a5f..."')
    })
  })
})
