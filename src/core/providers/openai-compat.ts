// Adaptador para cualquier API compatible con OpenAI /chat/completions:
// DeepSeek, Qwen, Kimi, GLM, MiniMax, Grok, Mistral, Groq, Together,
// Fireworks, OpenRouter, Gemini (endpoint compatible), Ollama, LM Studio…

import { netFetch } from '../net'
import type { ChatMessage, ToolCall } from '../types'
import { safeJsonParse } from '../util'
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

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function authHeaders(p: ProviderConfig, apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', ...(p.headers ?? {}) }
  if (apiKey) h.authorization = `Bearer ${apiKey}`
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

export const openAiAdapter: ProviderAdapter = {
  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const { provider, model, params } = req
    const body: Record<string, unknown> = {
      model: model.id,
      messages: toOpenAiMessages(req.system, req.messages, {
        vision: model.vision ?? false,
        sendReasoningBack: provider.sendReasoningBack ?? false,
      }),
      stream: true,
      stream_options: { include_usage: true },
    }
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }))
      body.tool_choice = 'auto'
    }
    if (params.temperature !== undefined) body.temperature = params.temperature
    if (params.topP !== undefined) body.top_p = params.topP
    if (params.maxTokens) body.max_tokens = params.maxTokens
    if (params.reasoningEffort) body.reasoning_effort = params.reasoningEffort

    const res = await netFetch(
      endpoint(provider.baseUrl, '/chat/completions'),
      { method: 'POST', headers: authHeaders(provider, req.apiKey), body: JSON.stringify(body), signal: req.signal },
      { purpose: 'llm', label: req.label ?? `${provider.name} · ${model.id}`, via: provider.connection, guard: false, priorRedactions: req.redactions },
    )
    if (!res.ok || !res.body) throw new ProviderError(`${provider.name} respondió ${res.status}: ${await readError(res)}`, res.status)

    const calls = new Map<number, { id: string; name: string; args: string }>()
    const splitter = new ThinkSplitter()
    let finish = ''
    let reasoningAll = ''
    for await (const ev of parseSse(res.body, req.signal)) {
      if (ev.data === '[DONE]') break
      const parsed = safeJsonParse<Record<string, unknown>>(ev.data)
      if (!parsed.ok) continue
      const chunk = parsed.value as {
        error?: { message?: string }
        choices?: Array<{
          delta?: {
            content?: string | null
            reasoning_content?: string | null
            reasoning?: string | null
            tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
          }
          finish_reason?: string | null
        }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          completion_tokens_details?: { reasoning_tokens?: number }
          prompt_tokens_details?: { cached_tokens?: number }
          prompt_cache_hit_tokens?: number
        } | null
        model?: string
      }
      if (chunk.error) throw new ProviderError(`${provider.name}: ${chunk.error.message ?? 'error en el stream'}`)
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
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
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
            cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? chunk.usage.prompt_cache_hit_tokens,
          },
        }
      }
    }
    for (const part of splitter.flush()) yield part

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
    const res = await netFetch(
      endpoint(provider.baseUrl, '/models'),
      { method: 'GET', headers: authHeaders(provider, apiKey), signal },
      { purpose: 'models', label: `${provider.name} · modelos`, via: provider.connection, guard: false },
    )
    if (!res.ok) throw new ProviderError(`No se pudo listar modelos (${res.status}): ${await readError(res)}`, res.status)
    const data = (await res.json()) as { data?: Array<{ id: string; context_length?: number }>; models?: Array<{ name: string }> }
    const list = data.data?.map((m) => ({ id: m.id, contextWindow: m.context_length })) ?? data.models?.map((m) => ({ id: m.name })) ?? []
    return list.sort((a, b) => a.id.localeCompare(b.id))
  },
}
