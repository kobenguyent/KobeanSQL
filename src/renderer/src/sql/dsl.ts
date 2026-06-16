import type { DatabaseType, ProcedureInfo } from '../types'

export function quote(name: string, dbType: DatabaseType): string {
  if (dbType === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  if (dbType === 'mysql' || dbType === 'mariadb') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

const qual = (db: DatabaseType, name: string, sch?: string) => sch ? `${quote(sch, db)}.${quote(name, db)}` : quote(name, db)

export function buildSelectTableSql(
  db: DatabaseType,
  tbl: string,
  sch: string | undefined,
  limit: number,
  filter?: { column: string; value: unknown }
): string {
  if (db === 'mongodb') return `db.${tbl}.find(${JSON.stringify(filter ? { [filter.column]: filter.value } : {})}).limit(${limit})`
  
  const q = (n: string) => quote(n, db)
  const v = (val: any) => {
    if (val == null) return 'NULL'
    if (typeof val === 'number') return String(val)
    if (typeof val === 'boolean') return db === 'mssql' ? (val ? '1' : '0') : (val ? 'TRUE' : 'FALSE')
    return `'${String(val).replace(/'/g, "''")}'`
  }

  const where = filter ? ` WHERE ${q(filter.column)} = ${v(filter.value)}` : ''
  const table = qual(db, tbl, sch)

  if (db === 'mssql') return `SELECT TOP ${limit} * FROM ${table}${where};`
  return `SELECT * FROM ${table}${where} LIMIT ${limit};`
}

export function buildProcedureCallSql(db: DatabaseType, name: string, type: ProcedureInfo['type'], sch?: string): string {
  const r = qual(db, name, sch)
  if (type === 'function') return `SELECT ${r}();`
  return db === 'mssql' ? `EXEC ${r};` : `CALL ${r}();`
}

export { quote as quoteIdentifier }
