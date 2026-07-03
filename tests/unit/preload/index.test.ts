import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn()
  },
  ipcRenderer: {
    invoke: invokeMock,
    on: vi.fn(),
    off: vi.fn()
  }
}))

vi.mock('@electron-toolkit/preload', () => ({
  electronAPI: {}
}))

describe('preload row mutation payload contract', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('forwards structured insert-row payloads to IPC and returns the structured mutation result', async () => {
    invokeMock.mockResolvedValue({
      success: true,
      sql: 'INSERT INTO "users" ("name") VALUES (\'Ada\');'
    })

    const { dbAPI } = await import('../../../src/preload')
    const payload = {
      connectionId: 'pg-1',
      tableName: 'users',
      database: 'app',
      schema: 'public',
      databaseType: 'postgres' as const,
      rowData: { name: 'Ada' }
    }

    await expect(dbAPI.insertRow(payload)).resolves.toEqual({
      success: true,
      sql: 'INSERT INTO "users" ("name") VALUES (\'Ada\');'
    })
    expect(invokeMock).toHaveBeenCalledWith('db:insert-row', payload)
  })

  it('forwards structured delete-row payloads to IPC and preserves backend errors', async () => {
    invokeMock.mockResolvedValue({
      success: false,
      sql: 'DELETE FROM "public"."users" WHERE "id" = 1;',
      error: 'Delete row mutations are not supported for mongodb.'
    })

    const { dbAPI } = await import('../../../src/preload')
    const payload = {
      connectionId: 'pg-1',
      tableName: 'users',
      database: 'app',
      schema: 'public',
      databaseType: 'postgres' as const,
      pkColumns: [{ name: 'id', type: 'int4', nullable: false, primaryKey: true }],
      rowData: { id: 1, name: 'Ada' }
    }

    await expect(dbAPI.deleteRow(payload)).resolves.toEqual({
      success: false,
      sql: 'DELETE FROM "public"."users" WHERE "id" = 1;',
      error: 'Delete row mutations are not supported for mongodb.'
    })
    expect(invokeMock).toHaveBeenCalledWith('db:delete-row', payload)
  })

  it('forwards structured duplicate-row payloads to IPC', async () => {
    invokeMock.mockResolvedValue({
      success: true,
      sql: 'INSERT INTO "public"."users" ("name") VALUES (\'Ada\');'
    })

    const { dbAPI } = await import('../../../src/preload')
    const payload = {
      connectionId: 'pg-1',
      tableName: 'users',
      database: 'app',
      schema: 'public',
      databaseType: 'postgres' as const,
      pkColumns: [{ name: 'id', type: 'int4', nullable: false, primaryKey: true }],
      rowData: { id: 1, name: 'Ada' }
    }

    await expect(dbAPI.duplicateRow(payload)).resolves.toEqual({
      success: true,
      sql: 'INSERT INTO "public"."users" ("name") VALUES (\'Ada\');'
    })
    expect(invokeMock).toHaveBeenCalledWith('db:duplicate-row', payload)
  })

  it('forwards copy-table preview payloads to IPC and returns preview statements', async () => {
    invokeMock.mockResolvedValue({
      success: true,
      statements: [
        'CREATE TABLE "public"."users_backup" (LIKE "public"."users" INCLUDING ALL);',
        'INSERT INTO "public"."users_backup" SELECT * FROM "public"."users";'
      ]
    })

    const { dbAPI } = await import('../../../src/preload')
    const payload = {
      connectionId: 'pg-1',
      databaseType: 'postgres' as const,
      sourceTable: 'users',
      sourceSchema: 'public',
      targetTable: 'users_backup',
      targetSchema: 'public',
      mode: 'schema-and-data' as const
    }

    await expect(dbAPI.copyTablePreview(payload)).resolves.toEqual({
      success: true,
      statements: [
        'CREATE TABLE "public"."users_backup" (LIKE "public"."users" INCLUDING ALL);',
        'INSERT INTO "public"."users_backup" SELECT * FROM "public"."users";'
      ]
    })
    expect(invokeMock).toHaveBeenCalledWith('db:copy-table-preview', payload)
  })

  it('forwards copy-table execute payloads to IPC and preserves backend failures', async () => {
    invokeMock.mockResolvedValue({
      success: false,
      statements: ['CREATE TABLE "public"."users_backup" (LIKE "public"."users" INCLUDING ALL);'],
      error: 'relation "users_backup" already exists'
    })

    const { dbAPI } = await import('../../../src/preload')
    const payload = {
      connectionId: 'pg-1',
      databaseType: 'postgres' as const,
      sourceTable: 'users',
      sourceSchema: 'public',
      targetTable: 'users_backup',
      targetSchema: 'public',
      mode: 'schema-only' as const
    }

    await expect(dbAPI.copyTableExecute(payload)).resolves.toEqual({
      success: false,
      statements: ['CREATE TABLE "public"."users_backup" (LIKE "public"."users" INCLUDING ALL);'],
      error: 'relation "users_backup" already exists'
    })
    expect(invokeMock).toHaveBeenCalledWith('db:copy-table-execute', payload)
  })
})
