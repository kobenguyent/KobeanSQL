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

export interface AISettings {
  provider: AIProvider
  baseUrl: string
  model: string
  localOnly: true
}

export interface LocalAIService {
  getSettings(): AISettings
  runTask(request: AIRequest): Promise<AIResponse>
}
