/** Column metadata for the schema visualizer */
export interface SchemaColumn {
  name: string
  type: string
  isPrimaryKey: boolean
  isForeignKey: boolean
}

/** Table metadata for the schema visualizer */
export interface SchemaTable {
  /** Unique identifier – matches the table name (or schema.table for multi-schema DBs) */
  id: string
  name: string
  columns: SchemaColumn[]
}

/** A Foreign Key relationship between two tables */
export interface SchemaRelationship {
  id: string
  sourceTable: string
  sourceColumn: string
  targetTable: string
  targetColumn: string
}

/** Full schema payload sent over IPC */
export interface DatabaseSchema {
  tables: SchemaTable[]
  relationships: SchemaRelationship[]
  /** Whether the schema was truncated due to a large number of tables */
  truncated?: boolean
}


/** Props accepted by the SchemaCanvas component */
export type SchemaViewMode = 'GLOBAL_MODE' | 'FOCUSED_MODE'
