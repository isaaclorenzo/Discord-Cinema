// Ejecuta hooks al estilo Claude Code dentro del sandbox:
// - command: script de bash (just-bash) que recibe el evento en JSON por stdin.
//   exit 0 → stdout (JSON opcional con decision/reason/additionalContext);
//   exit 2 → bloquea, con stderr como motivo.
// - js: función async en el worker sin red; devuelve {decision, reason, additionalContext}.
// - block: regex declarativa contra la entrada de la herramienta.

import type { HookRunner } from '../agent/loop'
import { runJavaScript } from '../sandbox/javascript'
import type { Workspace } from '../sandbox/workspace'
import type { ToolResult } from '../tools/types'
import { safeJsonParse } from '../util'
import type { HookDef, HookEvent } from './types'

export interface HookOutcome {
  block?: string
  context?: string
}

interface HookJson {
  decision?: 'block' | 'approve' | 'allow' | 'deny'
  reason?: string
  additionalContext?: string
  continue?: boolean
  stopReason?: string
  hookSpecificOutput?: {
    permissionDecision?: 'allow' | 'deny' | 'ask'
    permissionDecisionReason?: string
    additionalContext?: string
  }
}

function matches(h: HookDef, toolName?: string): boolean {
  if (!h.matcher || h.matcher === '*' || !toolName) return true
  try {
    return new RegExp(`^(?:${h.matcher})$`).test(toolName)
  } catch {
    return h.matcher === toolName
  }
}

function interpret(json: HookJson | null, fallbackText: string): HookOutcome {
  if (!json) return fallbackText.trim() ? { context: fallbackText.trim() } : {}
  const specific = json.hookSpecificOutput
  if (json.decision === 'block' || json.decision === 'deny' || specific?.permissionDecision === 'deny' || json.continue === false) {
    return { block: json.reason ?? specific?.permissionDecisionReason ?? json.stopReason ?? 'Blocked by hook' }
  }
  const context = json.additionalContext ?? specific?.additionalContext
  return context ? { context } : {}
}

async function runHook(h: HookDef, payload: Record<string, unknown>, ws: Workspace): Promise<HookOutcome> {
  if (h.type === 'block') {
    if (!h.pattern) return {}
    try {
      const re = new RegExp(h.pattern, 'i')
      return re.test(JSON.stringify(payload.tool_input ?? payload.prompt ?? '')) ? { block: h.reason ?? `Matched blocked pattern /${h.pattern}/` } : {}
    } catch {
      return {}
    }
  }
  if (h.type === 'js' && h.code) {
    const r = await runJavaScript(ws, h.code, { args: payload, timeoutMs: h.timeoutMs ?? 10_000 })
    if (!r.ok) return { context: `[hook error] ${r.error ?? r.stderr}` }
    const parsed = r.result ? safeJsonParse<HookJson>(r.result) : { ok: false as const, error: '' }
    return interpret(parsed.ok ? parsed.value : null, r.stdout)
  }
  if (h.type === 'command' && h.command) {
    const root = h.pluginRoot ?? '/workspace'
    const script = h.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', root).replaceAll('$CLAUDE_PLUGIN_ROOT', root)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), h.timeoutMs ?? 30_000)
    try {
      const res = await ws.bash.exec(script, {
        cwd: '/workspace',
        stdin: JSON.stringify(payload),
        signal: controller.signal,
        env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: '/workspace' },
      })
      if (res.exitCode === 2) return { block: res.stderr.trim() || 'Blocked by hook' }
      if (res.exitCode !== 0) return { context: res.stderr.trim() ? `[hook warning] ${res.stderr.trim()}` : undefined }
      const parsed = safeJsonParse<HookJson>(res.stdout.trim())
      return interpret(parsed.ok && typeof parsed.value === 'object' ? parsed.value : null, res.stdout)
    } finally {
      clearTimeout(timer)
    }
  }
  return {}
}

export async function runHooks(
  hooks: HookDef[],
  event: HookEvent,
  payload: Record<string, unknown>,
  ws: Workspace,
  toolName?: string,
): Promise<HookOutcome> {
  const relevant = hooks.filter((h) => h.event === event && matches(h, toolName))
  const contexts: string[] = []
  for (const h of relevant) {
    let out: HookOutcome
    try {
      out = await runHook(h, payload, ws)
    } catch (e) {
      out = { context: `[hook error] ${(e as Error).message}` }
    }
    if (out.block) return { block: out.block, context: contexts.join('\n') || undefined }
    if (out.context) contexts.push(out.context)
  }
  return contexts.length ? { context: contexts.join('\n') } : {}
}

export function createHookRunner(getHooks: () => HookDef[], ws: Workspace, sessionId: string): HookRunner {
  const base = { session_id: sessionId, cwd: '/workspace' }
  return {
    async preToolUse(tool, input) {
      return runHooks(getHooks(), 'PreToolUse', { ...base, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }, ws, tool)
    },
    async postToolUse(tool, input, result: ToolResult) {
      const out = await runHooks(
        getHooks(),
        'PostToolUse',
        { ...base, hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: { content: result.content, is_error: !!result.isError } },
        ws,
        tool,
      )
      return { context: [out.block, out.context].filter(Boolean).join('\n') || undefined }
    },
    async stop(lastText) {
      const out = await runHooks(getHooks(), 'Stop', { ...base, hook_event_name: 'Stop', last_message: lastText }, ws)
      return out.block ? { continueWith: out.block } : {}
    },
  }
}
