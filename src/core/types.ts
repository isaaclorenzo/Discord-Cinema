// Tipos compartidos del núcleo de Glasshouse (independientes de React).

export type JsonSchema = Record<string, unknown>

export interface ImagePart {
  mediaType: string
  /** base64 sin prefijo data: */
  data: string
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  /** Texto JSON original si no se pudo parsear. */
  rawArguments?: string
  parseError?: string
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cachedTokens?: number
}

export interface MessageMeta {
  model?: string
  providerId?: string
  usage?: Usage
  ttftMs?: number
  durationMs?: number
  costUsd?: number
  stopReason?: string
  /** Modelo que respondió realmente (p. ej. tras un fallback por rechazo). */
  servedBy?: string
  /** Mensaje generado por /compact. */
  isCompactSummary?: boolean
  /** Texto expandido de un comando / o skill. */
  expandedFrom?: string
  /** Redacciones del guard aplicadas en la petición que generó esta respuesta. */
  redactions?: number
}

/** Bloques nativos del proveedor que hay que reenviar sin modificar. */
export interface RawProviderContent {
  kind: 'anthropic' | 'openai'
  model: string
  content: unknown
}

export interface ToolDisplay {
  kind: 'diff' | 'terminal' | 'todos' | 'subagent' | 'web' | 'files' | 'preview' | 'code' | 'questions' | 'plan' | 'text'
  [key: string]: unknown
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  images?: ImagePart[]
  reasoning?: string
  toolCalls?: ToolCall[]
  /** role=tool */
  toolCallId?: string
  toolName?: string
  isError?: boolean
  display?: ToolDisplay
  raw?: RawProviderContent
  createdAt: number
  meta?: MessageMeta
  /** Contexto oculto inyectado por hooks/skills (se envía al modelo, la UI lo muestra discreto). */
  synthetic?: boolean
}

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export interface PermissionRules {
  allow: string[]
  deny: string[]
}
