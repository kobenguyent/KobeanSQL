import type { DatabaseType } from './types'

export interface DatabaseManagementCapabilities {
  canInsertRow: boolean
  canDeleteRow: boolean
  canDuplicateRow: boolean
  canInlineUpdateRow: boolean
  canCopyTable: boolean
  canManageSchema: boolean
  supportsForeignKeys: boolean
  supportsProcedures: boolean
}

const FULL_SQL_CAPABILITIES: DatabaseManagementCapabilities = {
  canInsertRow: true,
  canDeleteRow: true,
  canDuplicateRow: true,
  canInlineUpdateRow: true,
  canCopyTable: true,
  canManageSchema: true,
  supportsForeignKeys: true,
  supportsProcedures: true
}

const LIMITED_CAPABILITIES: DatabaseManagementCapabilities = {
  canInsertRow: false,
  canDeleteRow: false,
  canDuplicateRow: false,
  canInlineUpdateRow: false,
  canCopyTable: false,
  canManageSchema: false,
  supportsForeignKeys: false,
  supportsProcedures: false
}

export function getCapabilitiesForType(type: DatabaseType): DatabaseManagementCapabilities {
  switch (type) {
    case 'postgres':
    case 'mysql':
    case 'mariadb':
    case 'sqlite':
    case 'mssql':
    case 'cockroachdb':
      return { ...FULL_SQL_CAPABILITIES }
    default:
      return { ...LIMITED_CAPABILITIES }
  }
}
