import { fileTools } from './files'
import { execTools } from './exec'
import { webTools } from './web'
import { makeSkillTool, makeSlashCommandTool, makeTaskTool, staticAgentTools, type AgentDescriptor, type SkillDescriptor } from './agent'
import type { AnyTool } from './types'

export interface ToolsetOptions {
  agents: AgentDescriptor[]
  skills: SkillDescriptor[]
  commands: Array<{ name: string; description: string }>
  extra?: AnyTool[]
  /** Herramientas desactivadas por el usuario. */
  disabled?: string[]
  /** Lista blanca (sub-agentes): si se define, solo estas. */
  only?: string[]
  /** Los sub-agentes no pueden lanzar más sub-agentes. */
  allowTask?: boolean
}

export const BUILTIN_TOOL_NAMES = [
  ...fileTools.map((t) => t.name),
  ...execTools.map((t) => t.name),
  ...webTools.map((t) => t.name),
  ...staticAgentTools.map((t) => t.name),
  'Task',
  'Skill',
  'SlashCommand',
]

export function buildToolset(opts: ToolsetOptions): AnyTool[] {
  const tools: AnyTool[] = [...fileTools, ...execTools, ...webTools, ...staticAgentTools]
  if (opts.allowTask !== false && opts.agents.length) tools.push(makeTaskTool(opts.agents))
  if (opts.skills.length) tools.push(makeSkillTool(opts.skills))
  if (opts.commands.length) tools.push(makeSlashCommandTool(opts.commands))
  tools.push(...(opts.extra ?? []))
  const disabled = new Set(opts.disabled ?? [])
  let out = tools.filter((t) => !disabled.has(t.name))
  if (opts.only) {
    const only = new Set(opts.only)
    out = out.filter((t) => only.has(t.name) || [...only].some((o) => o.endsWith('*') && t.name.startsWith(o.slice(0, -1))))
  }
  // Nombres únicos (una herramienta de plugin no puede pisar una builtin).
  const seen = new Set<string>()
  return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
}
