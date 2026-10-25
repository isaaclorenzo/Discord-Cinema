// Tipos de extensiones: skills, comandos, agentes, hooks, servidores MCP,
// herramientas de plugin y suites de evaluación.

import type { JsonSchema } from '../types'

export type ExtSource = 'builtin' | 'user' | `plugin:${string}`

export interface Skill {
  id: string
  name: string
  description: string
  body: string
  allowedTools?: string[]
  /** Archivos de apoyo (ruta relativa → contenido). */
  files: Record<string, string>
  source: ExtSource
  enabled: boolean
}

export interface SlashCommand {
  id: string
  name: string
  description: string
  argumentHint?: string
  allowedTools?: string[]
  template: string
  source: ExtSource
  enabled: boolean
}

export interface AgentDef {
  id: string
  name: string
  description: string
  systemPrompt: string
  /** undefined = todas las herramientas (salvo Task). */
  tools?: string[]
  /** 'inherit' o "providerId::modelId" */
  model?: string
  source: ExtSource
  enabled: boolean
}

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop' | 'SessionStart'

export interface HookDef {
  id: string
  event: HookEvent
  /** Regex contra el nombre de la herramienta (Pre/PostToolUse). Vacío = todas. */
  matcher?: string
  type: 'command' | 'js' | 'block'
  /** command: script de bash (recibe el JSON del evento por stdin). */
  command?: string
  /** js: cuerpo de función async (input) => ({decision, reason, additionalContext}). */
  code?: string
  /** block: regex contra el JSON de la entrada; si coincide, se bloquea. */
  pattern?: string
  reason?: string
  timeoutMs?: number
  source: ExtSource
  enabled: boolean
  /** Raíz de archivos del plugin (para ${CLAUDE_PLUGIN_ROOT}). */
  pluginRoot?: string
}

export interface McpServerDef {
  id: string
  name: string
  url: string
  transport: 'http' | 'sse'
  headers?: Record<string, string>
  connection: 'direct' | 'relay'
  source: ExtSource
  enabled: boolean
}

export interface PluginToolDef {
  id: string
  name: string
  description: string
  inputSchema: JsonSchema
  /** Cuerpo de función async: recibe (fs, host, args, console). */
  code: string
  network?: boolean
  readOnly?: boolean
  source: ExtSource
  enabled: boolean
}

export interface EvalCheck {
  type: 'answer_contains' | 'answer_regex' | 'file_exists' | 'file_contains' | 'file_regex' | 'bash' | 'no_tool_input_contains' | 'tool_called' | 'judge'
  value?: string
  path?: string
  command?: string
  tool?: string
  /** Para judge: criterio en lenguaje natural. */
  criteria?: string
  negate?: boolean
}

export interface EvalTask {
  id: string
  name: string
  prompt: string
  files?: Record<string, string>
  checks: EvalCheck[]
  maxTurns?: number
}

export interface EvalSuite {
  id: string
  name: string
  description: string
  tasks: EvalTask[]
  source: ExtSource
}

export interface Plugin {
  id: string
  name: string
  version: string
  description: string
  author?: string
  homepage?: string
  enabled: boolean
  source: 'builtin' | 'user'
  skills: Skill[]
  commands: SlashCommand[]
  agents: AgentDef[]
  hooks: HookDef[]
  mcpServers: McpServerDef[]
  tools: PluginToolDef[]
  evals: EvalSuite[]
  /** Archivos del plugin (scripts de hooks, etc.), montados en /plugins/<nombre>. */
  files: Record<string, string>
  /** Avisos de importación (p. ej. servidores MCP stdio no soportados). */
  warnings: string[]
}
