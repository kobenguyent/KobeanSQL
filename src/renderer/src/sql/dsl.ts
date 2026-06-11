import type { DatabaseType, ProcedureInfo } from '../types'

/**
 * Quotes a SQL identifier using the dialect-specific escaping rules for the active database.
 *
 * Use this whenever a table, schema, database, column, procedure, or function name comes from
 * user input or metadata so the generated SQL stays valid across supported dialects.
 */
export function quoteIdentifier(name: string, dbType: DatabaseType): string {
  switch (dbType) {
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`
    case 'mysql':
    case 'mariadb':
      return `\`${name.replace(/`/g, '``')}\``
    default:
      return `"${name.replace(/"/g, '""')}"`
  }
}

function qualifiedName(dbType: DatabaseType, name: string, schemaOrDatabase?: string): string {
  return schemaOrDatabase
    ? `${quoteIdentifier(schemaOrDatabase, dbType)}.${quoteIdentifier(name, dbType)}`
    : quoteIdentifier(name, dbType)
}

/**
 * Minimal fluent builder for `SELECT * FROM ...` queries.
 *
 * The builder intentionally keeps the surface area small so the Query Editor UI and store can
 * share the same dialect-aware SQL generation path without duplicating string templates.
 */
class SelectBuilder {
  private readonly clauses: string[] = []
  private readonly dbType: DatabaseType
  private limitValue?: number
  private whereClause?: { column: string; value: unknown }

  constructor(dbType: DatabaseType) {
    this.dbType = dbType
  }

  all(): SelectBuilder {
    this.clauses.push('SELECT *')
    return this
  }

  from(name: string, schemaOrDatabase?: string): SelectBuilder {
    const table = qualifiedName(this.dbType, name, schemaOrDatabase)
    this.clauses.push(`FROM ${table}`)
    return this
  }

  where(column: string, value: unknown): SelectBuilder {
    this.whereClause = { column, value }
    return this
  }

  limit(rows: number): SelectBuilder {
    this.limitValue = rows
    return this
  }

  build(): string {
    if (this.clauses.length === 0) return ''

    if (this.whereClause) {
      const q = (name: string) => quoteIdentifier(name, this.dbType)
      const v = (val: unknown) => {
        if (val === null || val === undefined) return 'NULL'
        if (typeof val === 'number' || typeof val === 'bigint') return String(val)
        if (typeof val === 'boolean') {
          if (this.dbType === 'mssql') return val ? '1' : '0'
          return val ? 'TRUE' : 'FALSE'
        }
        return `'${String(val).replace(/'/g, "''")}'`
      }
      this.clauses.push(`WHERE ${q(this.whereClause.column)} = ${v(this.whereClause.value)}`)
    }

    if (this.dbType === 'mssql' && this.limitValue && this.clauses[0] === 'SELECT *') {
      this.clauses[0] = `SELECT TOP ${this.limitValue} *`
      return `${this.clauses.join(' ')};`
    }
    if (this.limitValue) {
      return `${this.clauses.join(' ')} LIMIT ${this.limitValue};`
    }
    return `${this.clauses.join(' ')};`
  }
}

export function buildSelectTableSql(
  dbType: DatabaseType,
  tableName: string,
  schemaOrDatabase: string | undefined,
  limit: number,
  filter?: { column: string; value: unknown }
): string {
  if (dbType === 'mongodb') {
    const query = filter ? { [filter.column]: filter.value } : {}
    return `db.${tableName}.find(${JSON.stringify(query)}).limit(${limit})`
  }
  const builder = new SelectBuilder(dbType).all().from(tableName, schemaOrDatabase).limit(limit)
  if (filter) builder.where(filter.column, filter.value)
  return builder.build()
}

/**
 * Builds a runnable procedure/function stub for the given dialect.
 *
 * - Functions become `SELECT routine();`
 * - Procedures become `CALL routine();` except for SQL Server, which uses `EXEC routine;`
 */
export function buildProcedureCallSql(
  dbType: DatabaseType,
  routineName: string,
  routineType: ProcedureInfo['type'],
  schema?: string
): string {
  const routine = qualifiedName(dbType, routineName, schema)
  if (routineType === 'function') return `SELECT ${routine}();`
  return dbType === 'mssql' ? `EXEC ${routine};` : `CALL ${routine}();`
}
