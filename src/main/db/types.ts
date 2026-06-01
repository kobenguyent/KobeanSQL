export type DatabaseType = 'mysql' | 'mariadb' | 'postgres' | 'sqlite' | 'mssql' | 'mongodb'

export interface ConnectionConfig {
  id: string
  name: string
  type: DatabaseType
  connectionUri?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  filename?: string // for SQLite
  ssl?: boolean
  color?: string // connection indicator color
  category?: string // grouping label
}

export interface QueryResult {
  columns: ColumnDef[]
  rows: Record<string, unknown>[]
  rowCount: number
  duration: number
  error?: string
}

export interface ColumnDef {
  name: string
  type: string
  nullable?: boolean
  primaryKey?: boolean
}

export interface DatabaseInfo {
  name: string
}

export interface TableInfo {
  name: string
  type: 'table' | 'view'
  schema?: string
  rowCount?: number
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
  comment?: string
}

export interface ProcedureInfo {
  name: string
  schema?: string
  type: 'procedure' | 'function'
  /** Unique identifier for overloaded routines (e.g. Postgres specific_name) */
  specificName?: string
}

export interface SchemaInfo {
  databases: string[]
  tables: Record<string, TableInfo[]>
}

export interface ForeignKeyInfo {
  /** The FK column on this table */
  columnName: string
  /** The referenced table (may be schema-qualified) */
  referencedTable: string
  /** The referenced column */
  referencedColumn: string
}
