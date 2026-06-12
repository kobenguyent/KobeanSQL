import { appLogger } from '../logger'
import type { AIRequest, AIResponse, LocalAIService } from './types'
import { validateLocalBaseUrl } from './url-policy'

const DEFAULT_OPENAI_COMPATIBLE_URL = 'http://127.0.0.1:1234/v1'
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'local-model'
const OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS = 15000

export class OpenAICompatibleService implements LocalAIService {
  private readonly baseUrl: string
  private readonly model: string
  private readonly baseUrlValidationError?: string

  constructor(
    baseUrl = process.env.KOBEANSQL_OPENAI_URL ?? DEFAULT_OPENAI_COMPATIBLE_URL,
    model = process.env.KOBEANSQL_OPENAI_MODEL ?? DEFAULT_OPENAI_COMPATIBLE_MODEL
  ) {
    this.baseUrl = baseUrl
    this.model = model
    this.baseUrlValidationError = validateLocalBaseUrl(
      baseUrl,
      'KOBEANSQL_OPENAI_URL',
      DEFAULT_OPENAI_COMPATIBLE_URL
    )
  }

  getSettings(): { provider: 'openai-compatible'; baseUrl: string; model: string; localOnly: true } {
    return {
      provider: 'openai-compatible',
      baseUrl: this.baseUrl,
      model: this.model,
      localOnly: true
    }
  }

  async runTask(request: AIRequest): Promise<AIResponse> {
    if (this.baseUrlValidationError) {
      appLogger.error('Rejected non-local OpenAI-compatible URL', { baseUrl: this.baseUrl })
      return { success: false, error: this.baseUrlValidationError }
    }

    const messages = this.buildMessages(request)
    if (!messages) {
      return { success: false, error: 'Invalid AI request' }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS)
    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`

    try {
      appLogger.info('Running AI task with local OpenAI-compatible provider', {
        task: request.task,
        model: this.model
      })
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2
        })
      })

      if (!response.ok) {
        const text = await response.text()
        appLogger.error('OpenAI-compatible request failed', { status: response.status, text })
        return { success: false, error: `OpenAI-compatible provider error (${response.status})` }
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const output = payload.choices?.[0]?.message?.content?.trim()
      if (!output) {
        return { success: false, error: 'Empty response from OpenAI-compatible provider' }
      }
      return { success: true, output }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return {
          success: false,
          error: `Local OpenAI-compatible request timed out after ${Math.floor(OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS / 1000)}s`
        }
      }
      appLogger.error('Failed to call local OpenAI-compatible provider', {
        error: (error as Error).message
      })
      return {
        success: false,
        error:
          'Unable to reach local OpenAI-compatible endpoint. Ensure your local server is running (default: http://127.0.0.1:1234/v1).'
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private buildMessages(request: AIRequest): Array<{ role: 'system' | 'user'; content: string }> | null {
    const dbType = request.dbType ?? 'sql'
    const schema = request.schemaContext ? `\nSCHEMA CONTEXT (use these table and column names):\n${request.schemaContext}` : ''
    const systemPolicy =
      `You are a senior SQL database expert. KobeanSQL policy: local AI only, no telemetry, no cloud providers. Respond in plain text without markdown. ${schema}`
    switch (request.task) {
      case 'generate':
        if (!request.prompt?.trim()) return null
        return [
          { role: 'system', content: systemPolicy },
          {
            role: 'user',
            content: [
              `Generate valid ${dbType} SQL query based on the user request.`,
              'Return SQL only without markdown fences or explanations.',
              `User request: ${request.prompt.trim()}`
            ].join('\n')
          }
        ]
      case 'explain':
        if (!request.sql?.trim()) return null
        return [
          { role: 'system', content: systemPolicy },
          {
            role: 'user',
            content: [
              `Explain the following ${dbType} SQL clearly and concisely.`,
              'Keep explanation under 10 bullet points.',
              request.sql.trim()
            ].join('\n')
          }
        ]
      case 'optimize':
        if (!request.sql?.trim()) return null
        return [
          { role: 'system', content: systemPolicy },
          {
            role: 'user',
            content: [
              `Optimize the following ${dbType} SQL for performance and clarity.`,
              'Return only the improved SQL without markdown fences.',
              request.sql.trim()
            ].join('\n')
          }
        ]
      default:
        return null
    }
  }
}
