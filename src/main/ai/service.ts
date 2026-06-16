import { appLogger } from '../logger'
import { isIP } from 'node:net'

export type AIProvider = 'ollama' | 'openai-compatible'
export type AITaskType = 'generate' | 'explain' | 'optimize'

export interface AIRequest {
  task: AITaskType
  prompt?: string
  sql?: string
  dbType?: string
  schemaContext?: string
}

export interface AIResponse {
  success: boolean
  output?: string
  error?: string
}

const DEFAULTS = {
  ollama: { url: 'http://127.0.0.1:11434', model: 'llama3.1' },
  'openai-compatible': { url: 'http://127.0.0.1:1234/v1', model: 'local-model' }
}

export class AIService {
  private readonly provider: AIProvider
  private readonly baseUrl: string
  private readonly model: string

  constructor(
    provider: string | undefined = process.env.KOBEANSQL_AI_PROVIDER,
    baseUrl?: string,
    model?: string
  ) {
    this.provider = (provider?.toLowerCase() === 'openai-compatible' || provider?.toLowerCase() === 'openai') 
      ? 'openai-compatible' : 'ollama'
    this.baseUrl = baseUrl || (this.provider === 'ollama' ? (process.env.KOBEANSQL_OLLAMA_URL || DEFAULTS.ollama.url) : (process.env.KOBEANSQL_OPENAI_URL || DEFAULTS['openai-compatible'].url))
    this.model = model || (this.provider === 'ollama' ? (process.env.KOBEANSQL_OLLAMA_MODEL || DEFAULTS.ollama.model) : (process.env.KOBEANSQL_OPENAI_MODEL || DEFAULTS['openai-compatible'].model))
  }

  getSettings() {
    return { provider: this.provider, baseUrl: this.baseUrl, model: this.model, localOnly: true }
  }

  async runTask(request: AIRequest): Promise<AIResponse> {
    const error = this.validateUrl()
    if (error) return { success: false, error }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    try {
      const isOllama = this.provider === 'ollama'
      const endpoint = isOllama ? `${this.baseUrl}/api/generate` : `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`
      
      const body = isOllama 
        ? { model: this.model, prompt: this.buildOllamaPrompt(request), stream: false }
        : { model: this.model, messages: this.buildOpenAIMessages(request) }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body)
      })

      if (!res.ok) throw new Error(`AI service returned ${res.status}`)
      const data = await res.json()
      return { success: true, output: isOllama ? data.response : data.choices[0].message.content }
    } catch (err) {
      return { success: false, error: (err as Error).name === 'AbortError' ? 'AI request timed out' : (err as Error).message }
    } finally {
      clearTimeout(timeout)
    }
  }

  static validateUrl(baseUrl: string): string | undefined {
    try {
      const url = new URL(baseUrl)
      const host = url.hostname.toLowerCase()
      const isLoopback = host === 'localhost' || isIP(host) === 4 && host.startsWith('127.') || host === '::1' || host === '0:0:0:0:0:0:0:1'
      return isLoopback ? undefined : 'Local AI only (localhost/127.0.0.1 required)'
    } catch { return 'Invalid AI base URL' }
  }

  private validateUrl(): string | undefined {
    return AIService.validateUrl(this.baseUrl)
  }

  private buildSystemPrompt(schema?: string): string {
    return `You are a senior SQL database expert. Local AI only. Plain text only. ${schema ? `\nSCHEMA:\n${schema}` : ''}`
  }

  private buildOllamaPrompt(req: AIRequest): string {
    const sys = this.buildSystemPrompt(req.schemaContext)
    if (req.task === 'generate') return `${sys}\nGenerate ${req.dbType || 'sql'} for: ${req.prompt}`
    if (req.task === 'explain') return `${sys}\nExplain this ${req.dbType || 'sql'}:\n${req.sql}`
    return `${sys}\nOptimize this ${req.dbType || 'sql'}:\n${req.sql}`
  }

  private buildOpenAIMessages(req: AIRequest): any[] {
    const sys = this.buildSystemPrompt(req.schemaContext)
    const content = req.task === 'generate' ? `Generate ${req.dbType || 'sql'} for: ${req.prompt}` : `${req.task === 'explain' ? 'Explain' : 'Optimize'} this ${req.dbType || 'sql'}:\n${req.sql}`
    return [{ role: 'system', content: sys }, { role: 'user', content }]
  }
}
