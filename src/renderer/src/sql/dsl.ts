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

  limit(rows: number): SelectBuilder {
    this.limitValue = rows
    return this
  }

  build(): string {
    if (this.clauses.length === 0) return ''
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
  limit: number
): string {
  if (dbType === 'mongodb') {
    return `db.${tableName}.find({}).limit(${limit})`
  }
  return new SelectBuilder(dbType).all().from(tableName, schemaOrDatabase).limit(limit).build()
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
