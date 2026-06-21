import { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, ProcedureInfo, ForeignKeyInfo } from './types'

export interface DatabaseAdapter {
  dialect: ConnectionConfig['type']
  connect(config: ConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  query(sql: string, params?: unknown[]): Promise<QueryResult>
  getDatabases(): Promise<string[]>
  getTables(database?: string): Promise<TableInfo[]>
  getColumns(table: string, database?: string): Promise<ColumnInfo[]>
  getForeignKeys(table: string, database?: string): Promise<ForeignKeyInfo[]>
  getProcedures(database?: string): Promise<ProcedureInfo[]>
  ping(): Promise<boolean>
  getServerVersion(): Promise<string>
  getInstantMetrics?(): Promise<Record<string, number>>
}
