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

export function buildBulkInsertSql(
  target: SqlMutationTarget,
  rows: Record<string, unknown>[]
): string | null {
  if (rows.length === 0) return null
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k))
      return set
    }, new Set<string>())
  )
  if (columns.length === 0) return null
  const columnSql = columns.map((col) => quoteIdentifier(col, target.databaseType)).join(', ')
  const valuesSql = rows
    .map((row) => `(${columns.map((col) => quoteValue(row[col], target.databaseType)).join(', ')})`)
    .join(', ')
  return `INSERT INTO ${qualifyTable(target)} (${columnSql}) VALUES ${valuesSql};`
}

function buildBulkWhereSql(
  target: SqlMutationTarget,
  pkColumns: ColumnInfo[],
  rows: Record<string, unknown>[]
): string | null {
  if (pkColumns.length === 0 || rows.length === 0) return null
  if (
    pkColumns.length === 1 &&
    rows.every((r) => r[pkColumns[0].name] !== null && r[pkColumns[0].name] !== undefined)
  ) {
    const colIdent = quoteIdentifier(pkColumns[0].name, target.databaseType)
    if (rows.length === 1) {
      return `${colIdent} = ${quoteValue(rows[0][pkColumns[0].name], target.databaseType)}`
    }
    const list = rows.map((r) => quoteValue(r[pkColumns[0].name], target.databaseType)).join(', ')
    return `${colIdent} IN (${list})`
  }
  const rowPredicates = rows.map((row) => {
    const clause = pkColumns
      .map((pk) => {
        const val = row[pk.name]
        const ident = quoteIdentifier(pk.name, target.databaseType)
        return val === null || val === undefined
          ? `${ident} IS NULL`
          : `${ident} = ${quoteValue(val, target.databaseType)}`
      })
      .join(' AND ')
    return pkColumns.length > 1 && rows.length > 1 ? `(${clause})` : clause
  })
  return rowPredicates.join(' OR ')
}

export function buildBulkUpdateSql(
  target: SqlMutationTarget,
  pkColumns: ColumnInfo[],
  rows: Record<string, unknown>[],
  changes: Record<string, unknown>
): string | null {
  const changeCols = Object.keys(changes)
  if (changeCols.length === 0) return null
  const whereSql = buildBulkWhereSql(target, pkColumns, rows)
  if (!whereSql) return null
  const setSql = changeCols
    .map((col) => `${quoteIdentifier(col, target.databaseType)} = ${quoteValue(changes[col], target.databaseType)}`)
    .join(', ')
  return `UPDATE ${qualifyTable(target)} SET ${setSql} WHERE ${whereSql};`
}

export function buildBulkDeleteSql(
  target: SqlMutationTarget,
  pkColumns: ColumnInfo[],
  rows: Record<string, unknown>[]
): string | null {
  const whereSql = buildBulkWhereSql(target, pkColumns, rows)
  if (!whereSql) return null
  return `DELETE FROM ${qualifyTable(target)} WHERE ${whereSql};`
}

export function buildBulkDuplicateSql(
  target: SqlMutationTarget,
  rows: Record<string, unknown>[],
  pkColumns: ColumnInfo[]
): string | null {
  if (rows.length === 0) return null
  const stripped = rows
    .map((row) => getDuplicateRowData(row, pkColumns))
    .filter((row) => Object.keys(row).length > 0)
  if (stripped.length === 0) return null
  return buildBulkInsertSql(target, stripped)
}
