import type { ColumnInfo, DatabaseType } from '../types'
import type { DatabaseManagementCapabilities } from '../capabilities'

export const INSERT_ROW_SQL_ERROR = 'Insert row mutation requires at least one column value.'
export const DELETE_ROW_SQL_ERROR = 'Delete row mutation requires at least one primary key column.'
export const DUPLICATE_ROW_SQL_ERROR = 'Duplicate row mutation requires at least one non-primary-key column.'

export interface SqlMutationTarget {
  tableName: string
  database?: string
  schema?: string
  databaseType: DatabaseType
}

export interface SqlInsertRowMutationPayload extends SqlMutationTarget {
  connectionId: string
  rowData: Record<string, unknown>
}

export interface SqlDeleteRowMutationPayload extends SqlMutationTarget {
  connectionId: string
  pkColumns: ColumnInfo[]
  rowData: Record<string, unknown>
}

export interface SqlDuplicateRowMutationPayload extends SqlMutationTarget {
  connectionId: string
  pkColumns: ColumnInfo[]
  rowData: Record<string, unknown>
}

export type SqlMutationCapability = keyof Pick<
  DatabaseManagementCapabilities,
  'canInsertRow' | 'canDeleteRow' | 'canDuplicateRow'
>

export function supportsSqlMutationCapability(
  capabilities: Pick<DatabaseManagementCapabilities, SqlMutationCapability>,
  capability: SqlMutationCapability
): boolean {
  return capabilities[capability]
}

export function quoteIdentifier(name: string, databaseType: DatabaseType): string {
  switch (databaseType) {
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`
    case 'mysql':
    case 'mariadb':
      return `\`${name.replace(/`/g, '``')}\``
    default:
      return `"${name.replace(/"/g, '""')}"`
  }
}

export function quoteValue(value: unknown, databaseType: DatabaseType): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') {
    if (databaseType === 'mssql') return value ? '1' : '0'
    return value ? 'TRUE' : 'FALSE'
  }

  const escaped = String(value).replace(/'/g, "''")
  const stringLiteral =
    databaseType === 'mysql' || databaseType === 'mariadb'
      ? escaped.replace(/\\/g, '\\\\')
      : escaped

  return `'${stringLiteral}'`
}

export function qualifyTable(target: SqlMutationTarget): string {
  const qualifier = target.schema ?? target.database
  const qualifiedTableName = quoteIdentifier(target.tableName, target.databaseType)
  return qualifier
    ? `${quoteIdentifier(qualifier, target.databaseType)}.${qualifiedTableName}`
    : qualifiedTableName
}

function getDuplicateRowData(
  rowData: Record<string, unknown>,
  pkColumns: ColumnInfo[]
): Record<string, unknown> {
  const nextRow = { ...rowData }
  for (const pkColumn of pkColumns) {
    delete nextRow[pkColumn.name]
  }
  return nextRow
}

export function buildInsertSql(target: SqlMutationTarget, rowData: Record<string, unknown>): string | null {
  const columns = Object.keys(rowData)
  if (columns.length === 0) return null
  const columnSql = columns.map((column) => quoteIdentifier(column, target.databaseType)).join(', ')
  const valueSql = columns.map((column) => quoteValue(rowData[column], target.databaseType)).join(', ')
  return `INSERT INTO ${qualifyTable(target)} (${columnSql}) VALUES (${valueSql});`
}

export function buildDeleteSql(
  target: SqlMutationTarget,
  pkColumns: ColumnInfo[],
  rowData: Record<string, unknown>
): string | null {
  if (pkColumns.length === 0) return null
  const whereSql = pkColumns
    .map((pkColumn) => {
      return `${quoteIdentifier(pkColumn.name, target.databaseType)} = ${quoteValue(rowData[pkColumn.name], target.databaseType)}`
    })
    .join(' AND ')

  return `DELETE FROM ${qualifyTable(target)} WHERE ${whereSql};`
}

export function buildDuplicateSql(
  target: SqlMutationTarget,
  rowData: Record<string, unknown>,
  pkColumns: ColumnInfo[]
): string | null {
  const nextRow = getDuplicateRowData(rowData, pkColumns)
  if (Object.keys(nextRow).length === 0) return null
  return buildInsertSql(target, nextRow)
}
