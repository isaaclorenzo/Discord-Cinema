// Adaptador para cualquier API compatible con OpenAI /chat/completions:
// DeepSeek, Qwen, Kimi, GLM, MiniMax, Grok, Mistral, Groq, Together,
// Fireworks, OpenRouter, Gemini (endpoint compatible), Ollama, LM Studio…

import { netFetch, relayAvailable } from '../net'
import { diagnoseRejection, endpointUrl, isAccountIssue, isTransient, learn, quirksFor, retryDelayMs, type ProviderQuirks, type QuirkFix } from './compat'
import { withPromptTools } from './prompt-tools'
import type { ChatMessage, ToolCall } from '../types'
import { safeJsonParse, sleep } from '../util'
import { parseSse, ThinkSplitter } from './sse'
import { ProviderError, type ModelInfo, type ProviderAdapter, type ProviderConfig, type StreamEvent, type StreamRequest } from './types'

type OaiContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: OaiContent | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
  reasoning_content?: string
}

function authHeaders(p: ProviderConfig, apiKey: string, all = false): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', ...(p.headers ?? {}) }
  if (apiKey) {
    h.authorization = `Bearer ${apiKey}`
    if (all) {
      h['api-key'] = apiKey
      h['x-api-key'] = apiKey
    }
  }
  return h
}

export function toOpenAiMessages(system: string, messages: ChatMessage[], opts: { vision: boolean; sendReasoningBack: boolean }): OaiMessage[] {
  const out: OaiMessage[] = []
  if (system) out.push({ role: 'system', content: system })
  let pendingImages: Array<{ name: string; images: NonNullable<ChatMessage['images']> }> = []
  const flushImages = () => {
    if (!pendingImages.length) return
    if (opts.vision) {
      const parts: Exclude<OaiContent, string> = []
      for (const p of pendingImages) {
        parts.push({ type: 'text', text: `[Images returned by tool ${p.name}]` })
        for (const img of p.images) parts.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })
      }
      out.push({ role: 'user', content: parts })
    }
    pendingImages = []
  }
  for (const m of messages) {
    if (m.role !== 'tool') flushImages()
    if (m.role === 'user') {
      if (m.images?.length && opts.vision) {
        out.push({
          role: 'user',
          content: [
            ...m.images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
            { type: 'text' as const, text: m.content || ' ' },
          ],
        })
      } else {
        const note = m.images?.length ? `\n\n[${m.images.length} image(s) omitted: this model has no vision support]` : ''
        out.push({ role: 'user', content: (m.content || ' ') + note })
      }
    } else if (m.role === 'assistant') {
      const msg: OaiMessage = { role: 'assistant', content: m.content || (m.toolCalls?.length ? null : ' ') }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.rawArguments && tc.parseError ? tc.rawArguments : JSON.stringify(tc.input) },
        }))
      }
      if (opts.sendReasoningBack && m.reasoning) msg.reasoning_content = m.reasoning
      out.push(msg)
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content || '(empty)' })
      if (m.images?.length) pendingImages.push({ name: m.toolName ?? 'tool', images: m.images })
    }
  }
  flushImages()
  return out
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  const parsed = safeJsonParse<{ error?: { message?: string } | string; message?: string }>(text)
  if (parsed.ok) {
    const v = parsed.value
    const msg = typeof v.error === 'string' ? v.error : (v.error?.message ?? v.message)
    if (msg) return msg
  }
  return text.slice(0, 500) || res.statusText
}

interface Completion {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
  tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
}

interface UsageJson {
  prompt_tokens?: number
  completion_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
  prompt_tokens_details?: { cached_tokens?: number }
  prompt_cache_hit_tokens?: number
}

function toUsage(u: UsageJson): StreamEvent {
  return {
    type: 'usage',
    usage: {
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens,
    },
  }
}

function buildBody(req: StreamRequest, q: ProviderQuirks): Record<string, unknown> {
  const { provider, model, params } = req
  const drop = new Set(q.drop ?? [])
  const body: Record<string, unknown> = {
    model: model.id,
    messages: toOpenAiMessages(req.system, req.messages, { vision: model.vision ?? false, sendReasoningBack: provider.sendReasoningBack ?? false }),
    stream: !q.noStream,
  }
  if (!q.noStream && !drop.has('stream_options')) body.stream_options = { include_usage: true }
  if (req.tools.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
    if (!drop.has('tool_choice')) body.tool_choice = 'auto'
  }
  if (params.temperature !== undefined && !drop.has('temperature')) body.temperature = params.temperature
  if (params.topP !== undefined && !drop.has('top_p')) body.top_p = params.topP
  const tokensParam = q.maxTokensParam ?? 'max_tokens'
  if (params.maxTokens && !drop.has(tokensParam)) body[tokensParam] = params.maxTokens
  if (params.reasoningEffort && !drop.has('reasoning_effort')) body.reasoning_effort = params.reasoningEffort
  return body
}

/** Error que indica que hay que repetir la petición con herramientas por prompt. */
export class ToolsUnsupportedError extends Error {
  constructor() {
    super('El modelo no admite herramientas nativas')
    this.name = 'ToolsUnsupportedError'
  }
}

const MAX_ATTEMPTS = 7

/** Petición con autocorrección: devuelve una respuesta OK o lanza un error explicativo. */
async function requestWithCompat(
  req: StreamRequest,
  path: string,
  init: (q: ProviderQuirks) => { method: string; body?: string },
  purpose: 'llm' | 'models',
  bodyFor?: (q: ProviderQuirks) => Record<string, unknown>,
): Promise<{ res: Response; q: ProviderQuirks }> {
  const { provider, model } = req
  let q = quirksFor(provider.id, model.id, model.quirks, provider.quirks)
  let via: 'direct' | 'relay' = q.connection ?? provider.connection
  let transient = 0
  const learnFix = (fix: QuirkFix) => {
    q = learn(provider.id, model.id, q, fix)
  }
  for (let attempt = 0; ; attempt++) {
    const { method, body } = init(q)
    let res: Response
    try {
      res = await netFetch(
        endpointUrl(provider.baseUrl, path, q.baseSuffix),
        { method, headers: authHeaders(provider, req.apiKey, q.authAll), body, signal: req.signal },
        { purpose, label: req.label ?? `${provider.name} · ${model.id}`, via, guard: false, priorRedactions: req.redactions },
      )
    } catch (e) {
      const alt = connectionFallback(e, via)
      if (alt && attempt < MAX_ATTEMPTS && !req.signal.aborted) {
        via = alt
        learnFix({ connection: alt })
        continue
      }
      throw e
    }
    if (res.ok) return { res, q }

    // ¿Error del propio relay (no configurado / sin token)? → probar en directo.
    if (via === 'relay' && !res.headers.get('x-relay-final-url') && [401, 403, 503].includes(res.status) && attempt < MAX_ATTEMPTS) {
      via = 'direct'
      learnFix({ connection: 'direct' })
      continue
    }

    const text = await readError(res)
    if (attempt < MAX_ATTEMPTS && !req.signal.aborted) {
      const fix = bodyFor ? diagnoseRejection(res.status, text, bodyFor(q), { baseUrl: provider.baseUrl + (q.baseSuffix ?? ''), authAll: q.authAll }) : null
      if (fix && !(fix.baseSuffix && q.baseSuffix)) {
        learnFix(fix)
        if (fix.promptTools) throw new ToolsUnsupportedError()
        continue
      }
      if (isTransient(res.status, text) && transient < 3) {
        await sleep(retryDelayMs(res.headers, transient++), req.signal)
        continue
      }
    }
    const account = isAccountIssue(text) ? ' (restricción de la cuenta en el proveedor)' : ''
    throw new ProviderError(`${provider.name} respondió ${res.status}${account}: ${text}`, res.status)
  }
}

function connectionFallback(e: unknown, via: 'direct' | 'relay'): 'direct' | 'relay' | null {
  if (!(e instanceof Error) || e.name === 'AbortError' || e.name === 'GuardBlockedError') return null
  const network = /CORS|Failed to fetch|NetworkError|Load failed|No hay relay|network/i.test(e.message)
  if (!network) return null
  if (via === 'direct') return relayAvailable() ? 'relay' : null
  return 'direct'
}

function* parseCompletionJson(data: { choices?: Array<{ message?: Completion; finish_reason?: string }>; usage?: UsageJson }): Generator<StreamEvent, string> {
  const choice = data.choices?.[0]
  const msg = choice?.message
  const r = msg?.reasoning_content ?? msg?.reasoning
  if (r) yield { type: 'reasoning', text: r }
  if (msg?.content) {
    const splitter = new ThinkSplitter()
    for (const part of [...splitter.push(msg.content), ...splitter.flush()]) yield part
  }
  if (data.usage) yield toUsage(data.usage)
  return choice?.finish_reason ?? ''
}

export const openAiAdapter: ProviderAdapter = {
  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const { provider, model } = req
    const { res, q } = await requestWithCompat(
      req,
      '/chat/completions',
      (qq) => ({ method: 'POST', body: JSON.stringify(buildBody(req, qq)) }),
      'llm',
      (qq) => buildBody(req, qq),
    )

    const calls = new Map<number, { id: string; name: string; args: string }>()
    let finish = ''
    let reasoningAll = ''
    const type = res.headers.get('content-type') ?? ''

    if (q.noStream || (type.includes('application/json') && !type.includes('event-stream'))) {
      // Respuesta completa (proveedor sin streaming o que lo ignora).
      const data = (await res.json()) as { choices?: Array<{ message?: Completion; finish_reason?: string }>; usage?: UsageJson; error?: { message?: string } }
      if (data.error) throw new ProviderError(`${provider.name}: ${data.error.message ?? 'error'}`)
      const gen = parseCompletionJson(data)
      for (let r = gen.next(); ; r = gen.next()) {
        if (r.done) {
          finish = r.value
          break
        }
        if (r.value.type === 'reasoning') reasoningAll += r.value.text
        yield r.value
      }
      for (const [i, tc] of (data.choices?.[0]?.message?.tool_calls ?? []).entries()) {
        calls.set(i, { id: tc.id ?? '', name: tc.function?.name ?? '', args: tc.function?.arguments ?? '' })
      }
    } else {
      if (!res.body) throw new ProviderError(`${provider.name}: respuesta vacía`)
      const splitter = new ThinkSplitter()
      for await (const ev of parseSse(res.body, req.signal)) {
        if (ev.data === '[DONE]') break
        const parsed = safeJsonParse<Record<string, unknown>>(ev.data)
        if (!parsed.ok) continue
        const chunk = parsed.value as {
          error?: { message?: string }
          choices?: Array<{ delta?: Completion; message?: Completion; finish_reason?: string | null }>
          usage?: UsageJson | null
        }
        if (chunk.error) throw new ProviderError(`${provider.name}: ${chunk.error.message ?? 'error en el stream'}`)
        const choice = chunk.choices?.[0]
        const delta = choice?.delta ?? choice?.message
        if (delta) {
          const r = delta.reasoning_content ?? delta.reasoning
          if (r) {
            reasoningAll += r
            yield { type: 'reasoning', text: r }
          }
          if (delta.content) {
            for (const part of splitter.push(delta.content)) {
              if (part.type === 'reasoning') reasoningAll += part.text
              yield part
            }
          }
          for (const tc of delta.tool_calls ?? []) {
            const idx = tc.index ?? calls.size
            const cur = calls.get(idx) ?? { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name += tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            calls.set(idx, cur)
          }
        }
        if (choice?.finish_reason) finish = choice.finish_reason
        if (chunk.usage) yield toUsage(chunk.usage)
      }
      for (const part of splitter.flush()) yield part
    }

    let n = 0
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      n++
      const call: ToolCall = { id: c.id || `call_${Date.now().toString(36)}_${n}`, name: c.name, input: {} }
      const args = c.args.trim() || '{}'
      const parsedArgs = safeJsonParse<Record<string, unknown>>(args)
      if (parsedArgs.ok && parsedArgs.value && typeof parsedArgs.value === 'object' && !Array.isArray(parsedArgs.value)) {
        call.input = parsedArgs.value
      } else {
        call.rawArguments = c.args
        call.parseError = parsedArgs.ok ? 'arguments must be a JSON object' : parsedArgs.error
      }
      yield { type: 'tool_call', call }
    }
    if (reasoningAll && provider.sendReasoningBack) {
      yield { type: 'raw', raw: { kind: 'openai', model: model.id, content: { reasoning_content: reasoningAll } } }
    }
    yield { type: 'stop', reason: finish || (calls.size ? 'tool_calls' : 'stop') }
  },

  async listModels(provider: ProviderConfig, apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
    const probe: StreamRequest = {
      provider,
      apiKey,
      model: { id: '__models__' },
      system: '',
      messages: [],
      tools: [],
      params: {},
      signal: signal ?? new AbortController().signal,
      label: `${provider.name} · modelos`,
    }
    const { res } = await requestWithCompat(probe, '/models', () => ({ method: 'GET' }), 'models', () => ({}))
    const data = (await res.json()) as { data?: Array<{ id: string; context_length?: number; name?: string }>; models?: Array<{ name: string; id?: string }> }
    const list = data.data?.map((m) => ({ id: m.id, contextWindow: m.context_length })) ?? data.models?.map((m) => ({ id: m.id ?? m.name })) ?? []
    return list.sort((a, b) => a.id.localeCompare(b.id))
  },
}

/**
 * Adaptador OpenAI con autocorrección completa: si el modelo rechaza las
 * herramientas nativas, repite el turno con herramientas por prompt (y lo
 * recuerda para la próxima vez).
 */
export const compatOpenAiAdapter: ProviderAdapter = {
  listModels: openAiAdapter.listModels,
  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const q = quirksFor(req.provider.id, req.model.id, req.model.quirks, req.provider.quirks)
    if (req.tools.length && (q.promptTools || req.model.toolMode === 'prompt')) {
      yield* withPromptTools(openAiAdapter).stream(req)
      return
    }
    try {
      yield* openAiAdapter.stream(req)
    } catch (e) {
      if (e instanceof ToolsUnsupportedError) {
        yield* withPromptTools(openAiAdapter).stream(req)
        return
      }
      throw e
    }
  },
}
