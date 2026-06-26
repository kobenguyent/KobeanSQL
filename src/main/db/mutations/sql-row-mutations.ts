import type { ColumnInfo, DatabaseType } from '../types'

const SQL_MUTATION_DATABASE_TYPES = new Set<DatabaseType>([
  'mysql',
  'mariadb',
  'postgres',
  'sqlite',
  'mssql',
  'cockroachdb',
  'clickhouse',
  'cassandra',
  'oracle'
])

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

export function isSqlMutationDatabaseType(databaseType: DatabaseType): boolean {
  return SQL_MUTATION_DATABASE_TYPES.has(databaseType)
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

export function buildInsertSql(target: SqlMutationTarget, rowData: Record<string, unknown>): string {
  const columns = Object.keys(rowData)
  const columnSql = columns.map((column) => quoteIdentifier(column, target.databaseType)).join(', ')
  const valueSql = columns.map((column) => quoteValue(rowData[column], target.databaseType)).join(', ')
  return `INSERT INTO ${qualifyTable(target)} (${columnSql}) VALUES (${valueSql});`
}

export function buildDeleteSql(
  target: SqlMutationTarget,
  pkColumns: ColumnInfo[],
  rowData: Record<string, unknown>
): string {
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
): string {
  const nextRow = { ...rowData }
  for (const pkColumn of pkColumns) {
    delete nextRow[pkColumn.name]
  }
  return buildInsertSql(target, nextRow)
}
