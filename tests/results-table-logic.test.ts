import { describe, expect, it } from 'vitest'
import {
  quoteIdentifierForDb,
  quoteValueForDb,
  buildInlineUpdateSql,
  buildDeleteSql,
  buildInlineUpdateMongoQuery,
  buildDeleteMongoQuery,
  buildMongoPkFilter
} from '../src/renderer/src/components/ResultsTable'
import { buildSelectTableSql } from '../src/renderer/src/sql/dsl'

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
