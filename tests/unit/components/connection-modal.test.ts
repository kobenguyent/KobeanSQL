import { describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '../../../src/main/db/types'
import { connectThenSaveConnection } from '../../../src/renderer/src/components/ConnectionModal'

describe('ConnectionModal connection persistence flow', () => {
  const config: ConnectionConfig = {
    id: 'conn-1',
    name: 'Broken DB',
    type: 'postgres',
    host: 'localhost',
    port: 5432
  }

  it('does not persist a new connection when connecting fails', async () => {
    const saveConnection = vi.fn()
    const connect = vi.fn().mockResolvedValue({ success: false, error: 'connection refused' })

    const result = await connectThenSaveConnection(config, { connect, saveConnection })

    expect(result).toEqual({ success: false, error: 'connection refused' })
    expect(connect).toHaveBeenCalledWith(config)
    expect(saveConnection).not.toHaveBeenCalled()
  })

  it('persists the connection after connecting succeeds', async () => {
    const calls: string[] = []
    const saveConnection = vi.fn(async () => {
      calls.push('save')
    })
    const connect = vi.fn(async () => {
      calls.push('connect')
      return { success: true }
    })

    const result = await connectThenSaveConnection(config, { connect, saveConnection })

    expect(result).toEqual({ success: true })
    expect(saveConnection).toHaveBeenCalledWith(config)
    expect(calls).toEqual(['connect', 'save'])
  })
})
