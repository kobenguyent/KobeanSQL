import { appLogger } from '../logger'
import type { AIRequest, AIResponse, LocalAIService } from './types'
import { validateLocalBaseUrl } from './url-policy'

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const DEFAULT_OLLAMA_MODEL = 'llama3.1'
const OLLAMA_REQUEST_TIMEOUT_MS = 15000

export class OllamaService implements LocalAIService {
  private readonly baseUrl: string
  private readonly model: string
  private readonly baseUrlValidationError?: string

  constructor(
    baseUrl = process.env.KOBEANSQL_OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
    model = process.env.KOBEANSQL_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL
  ) {
    this.baseUrl = baseUrl
    this.model = model
    this.baseUrlValidationError = this.validateBaseUrl(baseUrl)
  }

  getSettings(): { provider: 'ollama'; baseUrl: string; model: string; localOnly: true } {
    return { provider: 'ollama', baseUrl: this.baseUrl, model: this.model, localOnly: true }
  }

  async runTask(request: AIRequest): Promise<AIResponse> {
    if (this.baseUrlValidationError) {
      appLogger.error('Rejected non-local Ollama URL', { baseUrl: this.baseUrl })
      return { success: false, error: this.baseUrlValidationError }
    }

    const prompt = this.buildPrompt(request)
    if (!prompt) {
      return { success: false, error: 'Invalid AI request' }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS)

    try {
      appLogger.info('Running AI task with local Ollama', { task: request.task, model: this.model })
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false
        })
      })

      if (!response.ok) {
        const text = await response.text()
        appLogger.error('Ollama request failed', { status: response.status, text })
        return { success: false, error: `Ollama error (${response.status})` }
      }

      const payload = (await response.json()) as { response?: string }
      const output = payload.response?.trim()
      if (!output) {
        return { success: false, error: 'Empty response from Ollama' }
      }
      return { success: true, output }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return {
          success: false,
          error: `Local Ollama request timed out after ${Math.floor(OLLAMA_REQUEST_TIMEOUT_MS / 1000)}s`
        }
      }
      appLogger.error('Failed to call local Ollama', { error: (error as Error).message })
      return {
        success: false,
        error:
          'Unable to reach local Ollama. Make sure Ollama is running locally (default: http://127.0.0.1:11434).'
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private validateBaseUrl(baseUrl: string): string | undefined {
    return validateLocalBaseUrl(baseUrl, 'KOBEANSQL_OLLAMA_URL', DEFAULT_OLLAMA_URL)
  }

  private buildPrompt(request: AIRequest): string | null {
    const dbType = request.dbType ?? 'sql'
    const persona = 'You are a senior SQL database expert.'
    const policy = 'KobeanSQL policy: local AI only, no telemetry, no cloud providers.'
    const schema = request.schemaContext ? `\nSCHEMA CONTEXT (use these table and column names):\n${request.schemaContext}\n` : ''

    switch (request.task) {
      case 'generate':
        if (!request.prompt?.trim()) return null
        return [
          persona,
          policy,
          schema,
          `Generate valid ${dbType} SQL query based on the user request.`,
          'Return SQL only without markdown fences or explanations.',
          `User request: ${request.prompt.trim()}`
        ].join('\n')
      case 'explain':
        if (!request.sql?.trim()) return null
        return [
          persona,
          policy,
          schema,
          `Explain the following ${dbType} SQL clearly and concisely.`,
          'Treat the SQL below as the full input.',
          'Keep explanation under 10 bullet points.',
          request.sql.trim()
        ].join('\n')
      case 'optimize':
        if (!request.sql?.trim()) return null
        return [
          persona,
          policy,
          schema,
          `Optimize the following ${dbType} SQL for performance and clarity.`,
          'Return only the improved SQL without markdown fences.',
          request.sql.trim()
        ].join('\n')
      default:
        return null
    }
  }
}
