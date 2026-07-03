export type DatabaseType = 'mysql' | 'mariadb' | 'postgres' | 'sqlite' | 'mssql' | 'mongodb' | 'cockroachdb' | 'clickhouse' | 'cassandra' | 'redis' | 'elasticsearch' | 'oracle' | 'influxdb' | 'neo4j' | 'snowflake'

export type DatabaseCategory = 'relational' | 'document' | 'key-value' | 'wide-column' | 'time-series' | 'graph' | 'cloud-warehouse'

export const DB_CATEGORY: Record<DatabaseType, DatabaseCategory> = {
  mysql: 'relational',
  mariadb: 'relational',
  postgres: 'relational',
  sqlite: 'relational',
  mssql: 'relational',
  cockroachdb: 'relational',
  oracle: 'relational',
  mongodb: 'document',
  elasticsearch: 'document',
  redis: 'key-value',
  cassandra: 'wide-column',
  influxdb: 'time-series',
  neo4j: 'graph',
  clickhouse: 'cloud-warehouse',
  snowflake: 'cloud-warehouse'
}

export const DB_CATEGORY_LABELS: Record<DatabaseCategory, string> = {
  'relational': 'Relational SQL',
  'document': 'Document NoSQL',
  'key-value': 'Key-Value',
  'wide-column': 'Wide-Column',
  'time-series': 'Time-Series',
  'graph': 'Graph',
  'cloud-warehouse': 'Cloud Data Warehouse'
}

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
  engine?: string
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

export type { DatabaseManagementCapabilities } from './capabilities'
