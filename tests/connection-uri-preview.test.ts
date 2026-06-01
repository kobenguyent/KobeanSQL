import { describe, expect, it } from 'vitest'
import { parseConnectionUriPreview } from '../src/renderer/src/utils/connection-uri'

describe('connection URI preview parsing', () => {
  it('returns parsed preview for postgres uri', () => {
    const result = parseConnectionUriPreview('postgres', 'postgresql://alice:secret@db.local:5432/app_db?sslmode=require')
    expect(result.error).toBeUndefined()
    expect(result.parsed).toMatchObject({
      host: 'db.local',
      port: 5432,
      user: 'alice',
      database: 'app_db',
      ssl: true
    })
  })

  it('returns invalid scheme error', () => {
    const result = parseConnectionUriPreview('postgres', 'mysql://root:pass@localhost:3306/test')
    expect(result.error).toContain('Invalid URI scheme for postgres')
  })

  it('returns parsed preview for mongodb+srv uri', () => {
    const result = parseConnectionUriPreview('mongodb', 'mongodb+srv://alice:secret@cluster.example.com/app') // betterleaks:allow - test fixture

    expect(result.error).toBeUndefined()
    expect(result.parsed).toMatchObject({
      host: 'cluster.example.com',
      user: 'alice',
      database: 'app'
    })
  })
})
