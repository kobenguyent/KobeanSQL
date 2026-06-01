import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the pg Client used by PostgresAdapter (which CockroachDBAdapter extends)
const mockQuery = vi.fn()
const mockConnect = vi.fn()
const mockEnd = vi.fn()
const mockOn = vi.fn()
const mockOff = vi.fn()

vi.mock('pg', () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return { connect: mockConnect, end: mockEnd, query: mockQuery, on: mockOn, off: mockOff }
  })
}))

vi.mock('../src/main/db/connection-uri', () => ({
  resolveConnectionConfig: (config: unknown) => config
}))

describe('CockroachDBAdapter', () => {
  let adapter: import('../src/main/db/adapters/cockroachdb').CockroachDBAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockEnd.mockResolvedValue(undefined)
    mockOn.mockReturnThis()
    mockOff.mockReturnThis()
    const { CockroachDBAdapter } = await import('../src/main/db/adapters/cockroachdb')
    adapter = new CockroachDBAdapter()
  })

  it('connects with default CockroachDB port 26257', async () => {
    const { Client } = await import('pg')
    await adapter.connect({ id: 'crdb', name: 'test', type: 'cockroachdb', host: 'localhost' })
    const callArg = (Client as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { port: number }
    expect(callArg.port).toBe(26257)
  })

  it('parses CockroachDB version string correctly', async () => {
    mockQuery.mockResolvedValue({
      fields: [{ name: 'version', dataTypeID: 25 }],
      rows: [{ version: 'CockroachDB CCL v23.2.1 (x86_64-pc-linux-gnu, built 2024/01/01)' }],
      rowCount: 1
    })
    await adapter.connect({ id: 'crdb', name: 'test', type: 'cockroachdb', host: 'localhost' })
    const version = await adapter.getServerVersion()
    expect(version).toBe('CockroachDB v23.2.1')
  })

  it('returns raw string when CockroachDB version format is unrecognised', async () => {
    mockQuery.mockResolvedValue({
      fields: [{ name: 'version', dataTypeID: 25 }],
      rows: [{ version: 'SomeOtherDB 1.0' }],
      rowCount: 1
    })
    await adapter.connect({ id: 'crdb', name: 'test', type: 'cockroachdb', host: 'localhost' })
    const version = await adapter.getServerVersion()
    expect(version).toBe('SomeOtherDB 1.0')
  })

  it('returns Unknown when version query fails', async () => {
    mockQuery.mockRejectedValue(new Error('connection lost'))
    await adapter.connect({ id: 'crdb', name: 'test', type: 'cockroachdb', host: 'localhost' })
    const version = await adapter.getServerVersion()
    expect(version).toBe('Unknown')
  })
})
