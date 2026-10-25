// Bucle de agente: modelo → herramientas → permisos → hooks → resultados → …
// Es independiente de React: la UI lo observa a través de un ConversationSink.

import { costOf, getAdapter } from '../providers'
import { ProviderError, type GenParams, type ModelInfo, type ProviderConfig } from '../providers/types'
import { GuardBlockedError, redactText, scanText, type Finding, type GuardConfig } from '../security/guard'
import type { Workspace } from '../sandbox/workspace'
import { coerceInput, validateInput } from '../tools/validate'
import type { AgentServices, AnyTool, ToolResult } from '../tools/types'
import type { ChatMessage, PermissionMode, PermissionRules, ToolCall, ToolDisplay, Usage } from '../types'
import { isAbortError, truncate, uid } from '../util'
import { checkPermission, suggestRule } from './permissions'

export interface ConversationSink {
  /** Historial actual (incluye mensajes archivados; el bucle los filtra). */
  messages(): ChatMessage[]
  push(m: ChatMessage): void
  update(id: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage)): void
}

export interface PermissionRequest {
  tool: AnyTool
  input: Record<string, unknown>
  summary: string
  suggestedRule: string
  /** Etiqueta del agente que pide permiso (sub-agente, columna de la Arena…). */
  label?: string
}

export type PermissionAnswer = { decision: 'allow' } | { decision: 'allow_always'; rule: string } | { decision: 'deny'; message?: string }

export interface PermissionPolicy {
  getMode(): PermissionMode
  getRules(): PermissionRules
  ask(req: PermissionRequest): Promise<PermissionAnswer>
  addAllowRule(rule: string): void
}

export interface HookRunner {
  preToolUse(tool: string, input: Record<string, unknown>): Promise<{ block?: string; context?: string }>
  postToolUse(tool: string, input: Record<string, unknown>, result: ToolResult): Promise<{ context?: string }>
  stop(lastText: string): Promise<{ continueWith?: string }>
}

export const NO_HOOKS: HookRunner = {
  preToolUse: async () => ({}),
  postToolUse: async () => ({}),
  stop: async () => ({}),
}

export interface AgentRunConfig {
  sessionId: string
  label?: string
  provider: ProviderConfig
  apiKey: string
  model: ModelInfo
  params: GenParams
  system: () => string
  tools: () => AnyTool[]
  ws: Workspace
  services: AgentServices
  permissions: PermissionPolicy
  hooks: HookRunner
  guard: GuardConfig
  /** El usuario confirmó enviar pese al guard: 'redact' o 'allow'. */
  guardOverride?: 'redact' | 'allow'
  maxTurns: number
  signal: AbortSignal
  sink: ConversationSink
  /** Se llama tras cada turno (para autocompactar, guardar, etc.). */
  afterTurn?: () => Promise<void>
}

export interface RunStats {
  turns: number
  toolCalls: number
  toolErrors: number
  usage: Usage
  costUsd: number
  ttftMs?: number
  durationMs: number
  stopReason: string
  finalText: string
  error?: string
}

/** Aplica el guard a lo que el proveedor aún no ha visto: system, usuario y resultados de herramientas. */
export function guardOutgoing(
  system: string,
  messages: ChatMessage[],
  cfg: GuardConfig,
  override: 'redact' | 'allow' | undefined,
  target: string,
): { system: string; messages: ChatMessage[]; redactions: number } {
  if (cfg.action === 'off' || override === 'allow') return { system, messages, redactions: 0 }
  const action = override === 'redact' ? 'redact' : cfg.action
  const findings: Finding[] = []
  const scanOnly = (text: string, where: string) => findings.push(...scanText(text, cfg, where))
  if (action === 'block' || action === 'warn') {
    scanOnly(system, 'system')
    messages.forEach((m, i) => {
      if (m.role !== 'assistant') scanOnly(m.content, `${m.role}#${i}`)
    })
    if (findings.length && action === 'block') throw new GuardBlockedError(findings, target)
    return { system, messages, redactions: 0 }
  }
  let redactions = 0
  const sys = redactText(system, cfg, 'system')
  redactions += sys.findings.length
  const out = messages.map((m, i) => {
    if (m.role === 'assistant') return m
    const r = redactText(m.content, cfg, `${m.role}#${i}`)
    redactions += r.findings.length
    return r.findings.length ? { ...m, content: r.text } : m
  })
  return { system: sys.text, messages: out, redactions }
}

function toolMessage(call: ToolCall, status: ChatMessage['status']): ChatMessage {
  return { id: uid('m'), role: 'tool', content: '', toolCallId: call.id, toolName: call.name, status, createdAt: Date.now() }
}

export async function runAgent(cfg: AgentRunConfig): Promise<RunStats> {
  const started = performance.now()
  const stats: RunStats = {
    turns: 0,
    toolCalls: 0,
    toolErrors: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    durationMs: 0,
    stopReason: '',
    finalText: '',
  }
  const adapter = getAdapter(cfg.provider, cfg.model)
  let jsonRetries = 0

  try {
    for (let turn = 0; turn < cfg.maxTurns; turn++) {
      if (cfg.signal.aborted) {
        stats.stopReason = 'aborted'
        break
      }
      stats.turns++
      const tools = cfg.tools()
      const history = cfg.sink.messages().filter((m) => !m.archived && !m.error && !m.local)
      const guarded = guardOutgoing(cfg.system(), history, cfg.guard, cfg.guardOverride, cfg.provider.name)

      const assistant: ChatMessage = {
        id: uid('m'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        meta: { model: cfg.model.id, providerId: cfg.provider.id, redactions: guarded.redactions || undefined },
      }
      cfg.sink.push(assistant)
      const turnStart = performance.now()
      let ttft: number | undefined
      let text = ''
      let reasoning = ''
      const calls: ToolCall[] = []
      let stop = ''
      let usage: Usage | undefined

      try {
        const stream = adapter.stream({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          model: cfg.model,
          system: guarded.system,
          messages: guarded.messages,
          tools: cfg.model.toolMode === 'none' ? [] : tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          params: cfg.params,
          signal: cfg.signal,
          label: cfg.label,
          redactions: guarded.redactions,
        })
        for await (const ev of stream) {
          if (ttft === undefined && (ev.type === 'text' || ev.type === 'reasoning' || ev.type === 'tool_call')) {
            ttft = performance.now() - turnStart
          }
          switch (ev.type) {
            case 'text':
              text += ev.text
              cfg.sink.update(assistant.id, { content: text })
              break
            case 'reasoning':
              reasoning += ev.text
              cfg.sink.update(assistant.id, { reasoning })
              break
            case 'tool_call':
              calls.push(ev.call)
              cfg.sink.update(assistant.id, { toolCalls: [...calls] })
              break
            case 'usage':
              usage = ev.usage
              break
            case 'raw':
              cfg.sink.update(assistant.id, { raw: ev.raw })
              break
            case 'served_by':
              cfg.sink.update(assistant.id, (m) => ({ ...m, meta: { ...m.meta, servedBy: ev.model } }))
              break
            case 'stop':
              stop = ev.reason
              break
          }
        }
      } catch (e) {
        if ((e as ProviderError & { retryable?: boolean }).retryable && jsonRetries < 2 && !cfg.signal.aborted) {
          jsonRetries++
          cfg.sink.update(assistant.id, { archived: true, content: `${text}\n\n_[reintento: entrada de herramienta con JSON inválido]_` })
          turn--
          continue
        }
        throw e
      }
      jsonRetries = 0

      const durationMs = Math.round(performance.now() - turnStart)
      if (usage) {
        stats.usage.inputTokens += usage.inputTokens
        stats.usage.outputTokens += usage.outputTokens
      }
      const cost = usage ? costOf(cfg.model, usage.inputTokens, usage.outputTokens) : 0
      stats.costUsd += cost
      if (stats.ttftMs === undefined && ttft !== undefined) stats.ttftMs = Math.round(ttft)
      cfg.sink.update(assistant.id, (m) => ({
        ...m,
        content: text,
        reasoning: reasoning || undefined,
        toolCalls: calls.length ? calls : undefined,
        meta: { ...m.meta, usage, ttftMs: ttft !== undefined ? Math.round(ttft) : undefined, durationMs, costUsd: cost || undefined, stopReason: stop },
      }))
      stats.stopReason = stop
      if (text.trim()) stats.finalText = text

      if (stop === 'refusal') break
      if (calls.length === 0) {
        const hook = await cfg.hooks.stop(text)
        if (hook.continueWith && turn < cfg.maxTurns - 1) {
          cfg.sink.push({ id: uid('m'), role: 'user', content: hook.continueWith, synthetic: true, createdAt: Date.now() })
          continue
        }
        break
      }

      const truncated = stop === 'max_tokens' || stop === 'length'
      await executeCalls(cfg, calls, truncated, stats)
      await cfg.afterTurn?.()
      if (turn === cfg.maxTurns - 1) stats.stopReason = 'max_turns'
    }
  } catch (e) {
    const aborted = isAbortError(e) || cfg.signal.aborted
    stats.stopReason = aborted ? 'aborted' : 'error'
    if (!aborted) stats.error = (e as Error).message
    const errMsg: ChatMessage = {
      id: uid('m'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      error:
        e instanceof GuardBlockedError
          ? { kind: 'guard', message: e.message, findings: e.findings.map((f) => ({ label: f.label, value: f.value, where: f.where })) }
          : aborted
            ? { kind: 'abort', message: 'Detenido por el usuario.' }
            : { kind: 'provider', message: (e as Error).message },
    }
    // Quita el mensaje del asistente vacío que quedó a medias.
    const last = cfg.sink.messages().at(-1)
    if (last?.role === 'assistant' && !last.content && !last.toolCalls?.length && !last.reasoning && !last.error) {
      cfg.sink.update(last.id, { archived: true })
    }
    cfg.sink.push(errMsg)
  }
  stats.durationMs = Math.round(performance.now() - started)
  return stats
}

async function executeCalls(cfg: AgentRunConfig, calls: ToolCall[], truncated: boolean, stats: RunStats): Promise<void> {
  const tools = cfg.tools()
  const byName = new Map(tools.map((t) => [t.name, t]))
  const placeholders = calls.map((c) => {
    const msg = toolMessage(c, 'running')
    cfg.sink.push(msg)
    return msg
  })

  const runOne = async (call: ToolCall, msgId: string) => {
    stats.toolCalls++
    const result = await executeCall(cfg, byName, call, msgId, truncated)
    if (result.isError) stats.toolErrors++
    cfg.sink.update(msgId, {
      content: result.content,
      images: result.images,
      isError: result.isError,
      display: result.display,
      status: result.denied ? 'denied' : 'done',
    })
  }

  // Herramientas de solo lectura sin permisos: en paralelo; el resto, en orden.
  let i = 0
  while (i < calls.length) {
    if (cfg.signal.aborted) {
      for (let k = i; k < calls.length; k++) {
        cfg.sink.update(placeholders[k].id, { content: 'Tool execution was cancelled by the user.', isError: true, status: 'denied' })
      }
      return
    }
    const tool = byName.get(calls[i].name)
    if (tool?.readOnly && tool.permission === 'none') {
      const batch: number[] = []
      while (i < calls.length) {
        const t = byName.get(calls[i].name)
        if (!(t?.readOnly && t.permission === 'none')) break
        batch.push(i++)
      }
      await Promise.all(batch.map((k) => runOne(calls[k], placeholders[k].id)))
    } else {
      await runOne(calls[i], placeholders[i].id)
      i++
    }
  }
}

async function executeCall(
  cfg: AgentRunConfig,
  byName: Map<string, AnyTool>,
  call: ToolCall,
  msgId: string,
  truncated: boolean,
): Promise<ToolResult & { denied?: boolean }> {
  const tool = byName.get(call.name)
  if (!tool) {
    return { content: `Unknown tool "${call.name}". Available tools: ${[...byName.keys()].join(', ')}`, isError: true }
  }
  if (truncated) {
    return { content: 'The response hit the max_tokens limit, so this tool call was cut off and not executed. Retry with shorter input (e.g. split large files into several writes).', isError: true }
  }
  if (call.parseError) {
    return {
      content: `Invalid tool arguments (${call.parseError}). Arguments must be a valid JSON object. Received: ${truncate(call.rawArguments ?? '', 2000)}`,
      isError: true,
    }
  }
  const input = coerceInput(tool.inputSchema, call.input)
  const errors = validateInput(tool.inputSchema, input)
  if (errors.length) return { content: `Invalid input for ${tool.name}: ${errors.join('; ')}`, isError: true }
  const custom = tool.validate?.(input)
  if (custom) return { content: `Invalid input for ${tool.name}: ${custom}`, isError: true }

  const decision = checkPermission(tool, input, cfg.permissions.getMode(), cfg.permissions.getRules())
  if (decision.behavior === 'deny') return { content: decision.reason, isError: true, denied: true }
  if (decision.behavior === 'ask') {
    cfg.sink.update(msgId, { status: 'awaiting' })
    const answer = await cfg.permissions.ask({
      tool,
      input,
      summary: tool.summarize?.(input) ?? '',
      suggestedRule: suggestRule(tool, input),
      label: cfg.label,
    })
    cfg.sink.update(msgId, { status: 'running' })
    if (answer.decision === 'deny') {
      return {
        content: `The user denied this ${tool.name} call.${answer.message ? ` Their message: ${answer.message}` : ' Do not retry it; ask the user or take another approach.'}`,
        isError: true,
        denied: true,
      }
    }
    if (answer.decision === 'allow_always') cfg.permissions.addAllowRule(answer.rule)
  }

  const pre = await cfg.hooks.preToolUse(tool.name, input)
  if (pre.block) return { content: `Blocked by a PreToolUse hook: ${pre.block}`, isError: true, denied: true }

  let result: ToolResult
  try {
    result = await tool.run(input, {
      ws: cfg.ws,
      sessionId: cfg.sessionId,
      toolCallId: call.id,
      signal: cfg.signal,
      agent: cfg.services,
      progress: (display: ToolDisplay) => cfg.sink.update(msgId, { display }),
    })
  } catch (e) {
    if (e instanceof GuardBlockedError) {
      result = {
        content: `${e.message} The request was not sent. Do not try to send secrets or personal data outside the sandbox.`,
        isError: true,
        display: { kind: 'text', title: 'Bloqueado por el escudo de privacidad', text: e.findings.map((f) => `${f.label} (${f.where})`).join('\n') },
      }
    } else if (isAbortError(e) && cfg.signal.aborted) {
      result = { content: 'Tool execution was cancelled by the user.', isError: true }
    } else {
      result = { content: `Tool ${tool.name} failed: ${(e as Error).message}`, isError: true }
    }
  }
  const pieces = [pre.context, result.content].filter(Boolean)
  const post = await cfg.hooks.postToolUse(tool.name, input, result)
  if (post.context) pieces.push(`<system-reminder>${post.context}</system-reminder>`)
  return { ...result, content: pieces.join('\n\n') }
}
