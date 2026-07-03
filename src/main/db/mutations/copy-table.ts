import type { DatabaseType } from '../types'
import { quoteIdentifier } from './sql-row-mutations'

export type CopyTableMode = 'schema-only' | 'data-only' | 'schema-and-data'

export interface CopyTablePayload {
  connectionId: string
  databaseType: DatabaseType
  sourceTable: string
  sourceDatabase?: string
  sourceSchema?: string
  targetTable: string
  targetDatabase?: string
  targetSchema?: string
  mode: CopyTableMode
}

function normalizeCopyTableName(value?: string): string {
  return value?.trim().toLowerCase() || ''
}

export function isSameCopyTableTarget(payload: CopyTablePayload): boolean {
  return (
    normalizeCopyTableName(payload.sourceTable) === normalizeCopyTableName(payload.targetTable) &&
    normalizeCopyTableName(payload.sourceSchema ?? payload.sourceDatabase) ===
      normalizeCopyTableName(payload.targetSchema ?? payload.targetDatabase)
  )
}

function qualifyTable(
  databaseType: DatabaseType,
  tableName: string,
  schema?: string,
  database?: string
): string {
  const qualifier = schema ?? database
  const quotedTable = quoteIdentifier(tableName, databaseType)
  return qualifier ? `${quoteIdentifier(qualifier, databaseType)}.${quotedTable}` : quotedTable
}

function buildPostgresCopyTablePreviewSql(payload: CopyTablePayload): string[] | null {
  if (!payload.sourceTable || !payload.targetTable) return null

  const sourceTable = qualifyTable(
    payload.databaseType,
    payload.sourceTable,
    payload.sourceSchema,
    payload.sourceDatabase
  )
  const targetTable = qualifyTable(
    payload.databaseType,
    payload.targetTable,
    payload.targetSchema,
    payload.targetDatabase
  )

  switch (payload.mode) {
    case 'schema-only':
      return [`CREATE TABLE ${targetTable} (LIKE ${sourceTable} INCLUDING ALL);`]
    case 'data-only':
      return [`INSERT INTO ${targetTable} SELECT * FROM ${sourceTable};`]
    case 'schema-and-data':
      return [
        `CREATE TABLE ${targetTable} (LIKE ${sourceTable} INCLUDING ALL);`,
        `INSERT INTO ${targetTable} SELECT * FROM ${sourceTable};`
      ]
    default:
      return null
  }
}

export function buildCopyTablePreviewSql(payload: CopyTablePayload): string[] | null {
  switch (payload.databaseType) {
    case 'postgres':
      return buildPostgresCopyTablePreviewSql(payload)
    default:
      return null
  }
}
