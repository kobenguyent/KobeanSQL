import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    transports: { file: { level: 'info', getFile: vi.fn(() => ({ path: '/tmp/kobeansql.log' })) } }
  }
}))

import { AIService } from '../src/main/ai/service'

describe('local AI service selection', () => {
  it('defaults to Ollama provider', () => {
    const service = new AIService()
    expect(service.getSettings().provider).toBe('ollama')
  })

  it('supports OpenAI-compatible local provider', () => {
    const service = new AIService('openai-compatible')
    expect(service.getSettings().provider).toBe('openai-compatible')
  })

  it('falls back to Ollama for unknown provider', () => {
    const service = new AIService('unknown-provider')
    expect(service.getSettings().provider).toBe('ollama')
  })
})

describe('local-only URL policy', () => {
  it('rejects invalid URL values', async () => {
    const res = await new AIService('ollama', 'not-a-url').runTask({ task: 'generate', prompt: 'list' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('Invalid AI base URL')
  })

  it('rejects non-local URLs', async () => {
    const res = await new AIService('ollama', 'https://example.com').runTask({ task: 'generate', prompt: 'list' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Local AI only')
  })
})
