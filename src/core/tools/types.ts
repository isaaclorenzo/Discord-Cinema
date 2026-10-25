import type { ImagePart, JsonSchema, PermissionMode, TodoItem, ToolDisplay } from '../types'
import type { Workspace } from '../sandbox/workspace'

export type PermissionClass = 'none' | 'edit' | 'exec' | 'network'

export interface ToolResult {
  content: string
  images?: ImagePart[]
  isError?: boolean
  display?: ToolDisplay
}

export interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: Array<{ label: string; description?: string }>
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface FetchedPage {
  url: string
  finalUrl: string
  status: number
  contentType: string
  text: string
}

export interface BackgroundShell {
  id: string
  command: string
  startedAt: number
  status: 'running' | 'completed' | 'failed' | 'killed'
  stdout: string
  stderr: string
  exitCode?: number
  readOffset: number
  controller: AbortController
}

/** Servicios que el bucle de agente ofrece a las herramientas. */
export interface AgentServices {
  getTodos(): TodoItem[]
  setTodos(todos: TodoItem[]): void
  askUser(questions: Question[]): Promise<Record<string, string>>
  requestPlanApproval(plan: string): Promise<{ approved: boolean; feedback?: string }>
  getMode(): PermissionMode
  setMode(mode: PermissionMode): void
  runSubagent(opts: {
    agentType: string
    description: string
    prompt: string
    signal: AbortSignal
    onUpdate: (display: ToolDisplay) => void
  }): Promise<string>
  loadSkill(name: string, args?: string): Promise<{ content: string } | { error: string }>
  runSlashCommand(command: string): Promise<{ content: string } | { error: string }>
  fetchPage(url: string, signal: AbortSignal): Promise<FetchedPage>
  webSearch(query: string, opts: { allowed?: string[]; blocked?: string[]; signal: AbortSignal }): Promise<SearchResult[]>
  /** Resume contenido web con el modelo (para WebFetch con prompt). */
  summarize(content: string, prompt: string, signal: AbortSignal): Promise<string>
  preview(target: { path?: string; html?: string; title?: string }): Promise<void>
  shells: Map<string, BackgroundShell>
  /** Ejecuta código de plugin con permiso de red explícito. */
  pluginFetch?: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
    status: number
    headers: Record<string, string>
    body: string
  }>
}

export interface ToolContext {
  ws: Workspace
  sessionId: string
  toolCallId: string
  signal: AbortSignal
  agent: AgentServices
  progress(display: ToolDisplay): void
}

export interface ToolDef<I = Record<string, unknown>> {
  name: string
  description: string
  inputSchema: JsonSchema
  /** Solo lectura: permitido en modo plan y ejecutable en paralelo. */
  readOnly: boolean
  permission: PermissionClass
  /** Origen (builtin, plugin:x, mcp:x) para la UI. */
  source?: string
  /** Texto corto para la tarjeta de la UI. */
  summarize?(input: I): string
  /** Clave para las reglas de permisos: comando, dominio o ruta. */
  matchKey?(input: I): string | undefined
  /** Validación extra tras el esquema; devuelve un mensaje de error o null. */
  validate?(input: I): string | null
  run(input: I, ctx: ToolContext): Promise<ToolResult>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>

export function errorResult(message: string): ToolResult {
  return { content: message, isError: true }
}
