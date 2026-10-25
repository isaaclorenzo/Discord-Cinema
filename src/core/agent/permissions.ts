// Permisos con la misma sintaxis que Claude Code:
//   "Bash"                  → toda la herramienta
//   "Bash(npm test)"        → comando exacto
//   "Bash(ls:*)"            → comandos que empiezan por "ls"
//   "WebFetch(domain:x.com)"→ dominio (y subdominios)
//   "Edit(/workspace/docs/**)" → glob de rutas
//   "mcp__servidor" / "mcp__servidor__tool"

import { minimatch } from 'minimatch'
import type { AnyTool } from '../tools/types'
import type { PermissionMode, PermissionRules } from '../types'

export type PermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; reason: string } | { behavior: 'ask' }

export const DEFAULT_RULES: PermissionRules = {
  // Todo lo que corre dentro del sandbox, sin red, se permite por defecto.
  allow: ['Bash', 'BashOutput', 'KillShell', 'Python', 'JavaScript'],
  deny: [],
}

interface ParsedRule {
  tool: string
  spec?: string
}

export function parseRule(rule: string): ParsedRule {
  const m = rule.trim().match(/^([^()]+?)(?:\((.*)\))?$/)
  if (!m) return { tool: rule.trim() }
  return { tool: m[1].trim(), spec: m[2]?.trim() || undefined }
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'LS', 'Glob', 'Grep'])

export function ruleMatches(rule: string, toolName: string, key: string | undefined): boolean {
  const r = parseRule(rule)
  if (r.tool.startsWith('mcp__') && !r.spec) {
    return toolName === r.tool || toolName.startsWith(`${r.tool}__`)
  }
  if (r.tool !== toolName && !(r.tool === 'Edit' && ['Write', 'MultiEdit', 'NotebookEdit'].includes(toolName))) return false
  if (!r.spec || r.spec === '*') return true
  if (key === undefined) return false
  if (r.spec.startsWith('domain:')) {
    const d = r.spec.slice(7).toLowerCase()
    const host = key.toLowerCase()
    return host === d || host.endsWith(`.${d}`)
  }
  if (FILE_TOOLS.has(toolName)) {
    const path = key.startsWith('/') ? key : `/workspace/${key}`
    return minimatch(path, r.spec, { dot: true }) || minimatch(path, `${r.spec.replace(/\/$/, '')}/**`, { dot: true })
  }
  if (r.spec.endsWith(':*')) {
    const prefix = r.spec.slice(0, -2)
    const cmd = key.trim()
    return cmd === prefix || cmd.startsWith(`${prefix} `)
  }
  return key.trim() === r.spec
}

export function checkPermission(tool: AnyTool, input: Record<string, unknown>, mode: PermissionMode, rules: PermissionRules): PermissionDecision {
  const key = tool.matchKey?.(input)
  const denied = rules.deny.find((r) => ruleMatches(r, tool.name, key))
  if (denied) return { behavior: 'deny', reason: `Denied by permission rule "${denied}".` }

  if (mode === 'plan' && !tool.readOnly) {
    return {
      behavior: 'deny',
      reason: `Plan mode is active: ${tool.name} is not allowed. Only read-only tools can be used until the plan is approved with ExitPlanMode.`,
    }
  }
  if (tool.permission === 'none') return { behavior: 'allow' }
  if (rules.allow.some((r) => ruleMatches(r, tool.name, key))) return { behavior: 'allow' }
  if (mode === 'bypassPermissions') return { behavior: 'allow' }
  if (mode === 'acceptEdits' && tool.permission === 'edit') return { behavior: 'allow' }
  return { behavior: 'ask' }
}

/** Regla sugerida para "Permitir siempre". */
export function suggestRule(tool: AnyTool, input: Record<string, unknown>): string {
  const key = tool.matchKey?.(input)
  if (!key) return tool.name
  if (tool.permission === 'network' && tool.name === 'WebFetch') return `WebFetch(domain:${key})`
  if (tool.name === 'Bash') {
    const first = key.trim().split(/\s+/)[0]
    return first ? `Bash(${first}:*)` : 'Bash'
  }
  if (FILE_TOOLS.has(tool.name)) return tool.name
  return tool.name
}

export const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

export const MODE_LABELS: Record<PermissionMode, { label: string; hint: string }> = {
  default: { label: 'Preguntar', hint: 'Pide permiso para editar, ejecutar o usar la red' },
  acceptEdits: { label: 'Aceptar ediciones', hint: 'Edita archivos sin preguntar; la red sigue pidiendo permiso' },
  plan: { label: 'Modo plan', hint: 'Solo herramientas de lectura hasta aprobar un plan' },
  bypassPermissions: { label: 'Sin permisos', hint: 'Todo se permite sin preguntar (incluida la red)' },
}

export function nextMode(m: PermissionMode): PermissionMode {
  return MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]
}
