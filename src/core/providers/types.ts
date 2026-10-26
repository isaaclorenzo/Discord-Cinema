import type { ChatMessage, JsonSchema, RawProviderContent, ToolCall, Usage } from '../types'
import type { ProviderQuirks } from './compat'

export type ProviderKind = 'openai' | 'anthropic' | 'mock' | 'webllm'

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
  /** Modelos pequeños (p. ej. locales): menos herramientas y descripciones cortas para que quepan en su contexto. */
  compactTools?: boolean
  /** Tamaño aproximado de descarga/VRAM (MB), para modelos locales. */
  sizeMB?: number
  /** Ajustes de compatibilidad aprendidos automáticamente para este modelo. */
  quirks?: ProviderQuirks
}

/** Cómo sale una petición: directa, por el relay propio o por el túnel cifrado (TLS en el navegador). */
export type Connection = 'direct' | 'relay' | 'tunnel'

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  presetId?: string
  baseUrl: string
  connection: Connection
  headers?: Record<string, string>
  models: ModelInfo[]
  enabled: boolean
  /** Reenviar reasoning_content en los mensajes del asistente (DeepSeek/Kimi con tools). */
  sendReasoningBack?: boolean
  /** Anthropic: fallback del servidor ante rechazos. */
  refusalFallback?: boolean
  /** Nota visible (p. ej. jurisdicción / política de datos del proveedor). */
  note?: string
  /** Ajustes de compatibilidad aprendidos para todo el proveedor. */
  quirks?: ProviderQuirks
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
