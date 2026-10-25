// Adaptador de Anthropic (Claude) con el SDK oficial. El fetch del SDK pasa
// por netFetch, así que también queda registrado en el inspector y puede ir
// por el relay.
//
// Notas de la API actual:
// - temperature/top_p ya no se envían (la API los rechaza desde 2026-10-21).
// - Pensamiento adaptativo con resumen visible; el esfuerzo va en output_config.
// - Los bloques del asistente (thinking con firma incluida) se reenvían sin
//   modificar; el historial es append-only.
// - Fallback del servidor ante rechazos en los modelos que lo admiten.

import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolUnion,
  BetaToolResultBlockParam,
  BetaImageBlockParam,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { makeSdkFetch } from '../net'
import type { ChatMessage, ToolCall } from '../types'
import { ProviderError, type ModelInfo, type ProviderAdapter, type ProviderConfig, type StreamEvent, type StreamRequest } from './types'

const ADAPTIVE = /claude-(opus|sonnet|haiku|fable|mythos)-(4-[678]|5)/
const NO_EXPLICIT_THINKING = /claude-(fable|mythos)-5/
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/

function client(provider: ProviderConfig, apiKey: string, label: string, redactions?: number): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: provider.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, ''),
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    defaultHeaders: provider.headers,
    fetch: makeSdkFetch({ purpose: 'llm', label, via: provider.connection, guard: false, priorRedactions: redactions }),
  })
}

function imageBlock(img: { mediaType: string; data: string }): BetaImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType as 'image/png', data: img.data },
  }
}

export function toAnthropicMessages(messages: ChatMessage[], vision: boolean): BetaMessageParam[] {
  const out: BetaMessageParam[] = []
  let toolResults: BetaToolResultBlockParam[] = []
  const flush = () => {
    if (toolResults.length) out.push({ role: 'user', content: toolResults })
    toolResults = []
  }
  for (const m of messages) {
    if (m.role === 'tool') {
      const content: Array<BetaTextBlockParam | BetaImageBlockParam> = [{ type: 'text', text: m.content || '(empty)' }]
      if (vision) for (const img of m.images ?? []) content.push(imageBlock(img))
      toolResults.push({ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content, is_error: m.isError || undefined })
      continue
    }
    flush()
    if (m.role === 'user') {
      const blocks: BetaContentBlockParam[] = []
      if (vision) for (const img of m.images ?? []) blocks.push(imageBlock(img))
      const note = !vision && m.images?.length ? `\n\n[${m.images.length} image(s) omitted: no vision support]` : ''
      blocks.push({ type: 'text', text: (m.content || ' ') + note })
      out.push({ role: 'user', content: blocks })
    } else {
      if (m.raw?.kind === 'anthropic' && Array.isArray(m.raw.content)) {
        out.push({ role: 'assistant', content: m.raw.content as BetaContentBlockParam[] })
        continue
      }
      const blocks: BetaContentBlockParam[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
      if (blocks.length === 0) blocks.push({ type: 'text', text: ' ' })
      out.push({ role: 'assistant', content: blocks })
    }
  }
  flush()
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: '(continuación)' })
  return out
}

function isJsonParseError(e: unknown): boolean {
  return e instanceof SyntaxError || (e instanceof Error && /JSON/i.test(e.message) && !(e instanceof Anthropic.APIError))
}

export const anthropicAdapter: ProviderAdapter = {
  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const { provider, model, params } = req
    const label = req.label ?? `${provider.name} · ${model.id}`
    const api = client(provider, req.apiKey, label, req.redactions)
    const useFallback = provider.refusalFallback !== false && FALLBACK_MODELS.test(model.id)

    const body: Record<string, unknown> = {
      model: model.id,
      max_tokens: params.maxTokens || model.maxOutput || 64000,
      system: req.system,
      messages: toAnthropicMessages(req.messages, model.vision ?? true),
    }
    if (req.tools.length) {
      body.tools = req.tools.map(
        (t) =>
          ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as { type: 'object' },
            eager_input_streaming: true,
          }) as BetaToolUnion,
      )
    }
    if (ADAPTIVE.test(model.id)) {
      if (!NO_EXPLICIT_THINKING.test(model.id)) body.thinking = { type: 'adaptive', display: 'summarized' }
      if (params.reasoningEffort) body.output_config = { effort: params.reasoningEffort }
    }
    if (useFallback) {
      body.betas = ['server-side-fallback-2026-07-01']
      body.fallbacks = 'default'
    }

    const toolIds = new Map<number, string>()
    try {
      const stream = api.beta.messages.stream(body as never, { signal: req.signal })
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          toolIds.set(event.index, event.content_block.id)
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text }
          else if (event.delta.type === 'thinking_delta') yield { type: 'reasoning', text: event.delta.thinking }
        }
      }
      const final = await stream.finalMessage()
      const calls: ToolCall[] = []
      for (const block of final.content) {
        if (block.type === 'tool_use') {
          const input = block.input
          calls.push({
            id: block.id,
            name: block.name,
            input: input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
          })
        }
      }
      for (const c of calls) yield { type: 'tool_call', call: c }
      yield { type: 'raw', raw: { kind: 'anthropic', model: model.id, content: final.content } }
      const usage = final.usage
      yield {
        type: 'usage',
        usage: {
          inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
          cachedTokens: usage.cache_read_input_tokens ?? undefined,
        },
      }
      const iterations = (usage as unknown as { iterations?: Array<{ type: string }> | null }).iterations ?? []
      if (final.model !== model.id || iterations.some((i) => i.type === 'fallback_message')) {
        yield { type: 'served_by', model: final.model }
      }
      yield { type: 'stop', reason: final.stop_reason ?? 'end_turn' }
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        throw new ProviderError(`Anthropic respondió ${e.status ?? ''}: ${e.message}`, e.status)
      }
      if (isJsonParseError(e)) {
        const err = new ProviderError('El modelo generó una entrada de herramienta con JSON inválido.')
        ;(err as ProviderError & { retryable?: boolean }).retryable = true
        throw err
      }
      throw e
    }
  },

  async listModels(provider: ProviderConfig, apiKey: string): Promise<ModelInfo[]> {
    const api = client(provider, apiKey, `${provider.name} · modelos`)
    const out: ModelInfo[] = []
    try {
      for await (const m of api.models.list()) {
        const info = m as unknown as { id: string; display_name?: string; max_input_tokens?: number | null; max_tokens?: number | null }
        out.push({
          id: info.id,
          label: info.display_name,
          contextWindow: info.max_input_tokens ?? undefined,
          maxOutput: info.max_tokens ?? undefined,
          vision: true,
          toolMode: 'native',
          reasoning: ADAPTIVE.test(info.id),
        })
      }
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw new ProviderError(`No se pudo listar modelos (${e.status}): ${e.message}`, e.status)
      throw e
    }
    return out
  },
}
