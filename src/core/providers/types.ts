import type { ChatMessage, JsonSchema, RawProviderContent, ToolCall, Usage } from '../types'

export type ProviderKind = 'openai' | 'anthropic' | 'mock'

export interface ModelInfo {
  id: string
  label?: string
  contextWindow?: number
  maxOutput?: number
  vision?: boolean
  /** native: function calling; prompt: protocolo XML en el prompt; none: sin herramientas. */
  toolMode?: 'native' | 'prompt' | 'none'
  reasoning?: boolean
  /** USD por millón de tokens */
  priceIn?: number
  priceOut?: number
}

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  presetId?: string
  baseUrl: string
  connection: 'direct' | 'relay'
  headers?: Record<string, string>
  models: ModelInfo[]
  enabled: boolean
  /** Reenviar reasoning_content en los mensajes del asistente (DeepSeek/Kimi con tools). */
  sendReasoningBack?: boolean
  /** Anthropic: fallback del servidor ante rechazos. */
  refusalFallback?: boolean
  /** Nota visible (p. ej. jurisdicción / política de datos del proveedor). */
  note?: string
}

export interface GenParams {
  temperature?: number
  topP?: number
  maxTokens?: number
  reasoningEffort?: '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export interface ToolSpec {
  name: string
  description: string
  inputSchema: JsonSchema
}

export interface StreamRequest {
  provider: ProviderConfig
  apiKey: string
  model: ModelInfo
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  params: GenParams
  signal: AbortSignal
  /** Etiqueta para el inspector (p. ej. "Arena · DeepSeek"). */
  label?: string
  redactions?: number
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'raw'; raw: RawProviderContent }
  | { type: 'served_by'; model: string }
  | { type: 'stop'; reason: string }

export interface ProviderAdapter {
  stream(req: StreamRequest): AsyncGenerator<StreamEvent>
  listModels(provider: ProviderConfig, apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]>
}

export class ProviderError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}
