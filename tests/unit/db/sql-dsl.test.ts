import { describe, expect, it } from 'vitest'
import { buildProcedureCallSql, buildSelectTableSql, quoteIdentifier } from '../../../src/renderer/src/sql/dsl'
import { buildCopyTablePreviewSql } from '../../../src/main/db/mutations/copy-table'

describe('KobeanSQL DSL', () => {
  it('builds dialect-aware SELECT table SQL', () => {
    expect(buildSelectTableSql('mssql', 'Orders', 'reporting', 25)).toBe(
      'SELECT TOP 25 * FROM [reporting].[Orders];'
    )
    expect(buildSelectTableSql('postgres', 'users', 'appdb', 10)).toBe(
      'SELECT * FROM "appdb"."users" LIMIT 10;'
    )
  })

  it('builds procedure and function call SQL', () => {
    expect(buildProcedureCallSql('postgres', 'refresh_stats', 'procedure', 'analytics')).toBe(
      'CALL "analytics"."refresh_stats"();'
    )
    expect(buildProcedureCallSql('mssql', 'syncUsers', 'procedure', 'dbo')).toBe('EXEC [dbo].[syncUsers];')
    expect(buildProcedureCallSql('postgres', 'fn_total', 'function', 'public')).toBe(
      'SELECT "public"."fn_total"();'
    )
  })

  it('quotes identifiers by dialect', () => {
    expect(quoteIdentifier('na]me', 'mssql')).toBe('[na]]me]')
    expect(quoteIdentifier('na`me', 'mysql')).toBe('`na``me`')
    expect(quoteIdentifier('na"me', 'postgres')).toBe('"na""me"')
  })

  it('builds postgres schema-and-data copy preview SQL', () => {
    expect(
      buildCopyTablePreviewSql({
        connectionId: 'pg-1',
        databaseType: 'postgres',
        sourceTable: 'users',
        sourceSchema: 'public',
        targetTable: 'users_backup',
        targetSchema: 'public',
        mode: 'schema-and-data'
      })
    ).toEqual([
      'CREATE TABLE "public"."users_backup" (LIKE "public"."users" INCLUDING ALL);',
      'INSERT INTO "public"."users_backup" SELECT * FROM "public"."users";'
    ])
  })
})
