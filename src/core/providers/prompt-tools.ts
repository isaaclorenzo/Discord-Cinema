// Tool-calling por prompt: para modelos sin function calling nativo.
// Se describen las herramientas en el system prompt y el modelo responde con
// bloques <tool_call>{"name": "...", "arguments": {...}}</tool_call>.

import type { ChatMessage, ToolCall } from '../types'
import { safeJsonParse, uid } from '../util'
import type { ProviderAdapter, StreamEvent, StreamRequest, ToolSpec } from './types'

export function promptToolInstructions(tools: ToolSpec[]): string {
  const list = tools
    .map((t) => `### ${t.name}\n${t.description}\nInput JSON schema: ${JSON.stringify(t.inputSchema)}`)
    .join('\n\n')
  return `# Tool use protocol
You can call tools. To call one, write exactly:
<tool_call>{"name": "ToolName", "arguments": {...}}</tool_call>
- You may emit several <tool_call> blocks in one reply; then STOP and wait. The results arrive in the next message inside <tool_result> blocks.
- Arguments must be valid JSON matching the schema. Never invent tool results.
- When you do not need a tool, answer normally.

# Available tools
${list}`
}

/** Convierte el historial a texto plano con bloques <tool_call>/<tool_result>. */
export function toPromptMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  let results: string[] = []
  const flush = () => {
    if (!results.length) return
    out.push({ id: uid('m'), role: 'user', content: results.join('\n\n'), createdAt: Date.now(), synthetic: true })
    results = []
  }
  for (const m of messages) {
    if (m.role === 'tool') {
      results.push(`<tool_result name="${m.toolName}" id="${m.toolCallId}"${m.isError ? ' error="true"' : ''}>\n${m.content}\n</tool_result>`)
      continue
    }
    flush()
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const calls = m.toolCalls.map((c) => `<tool_call>${JSON.stringify({ name: c.name, arguments: c.input })}</tool_call>`).join('\n')
      out.push({ ...m, content: [m.content, calls].filter(Boolean).join('\n'), toolCalls: undefined, raw: undefined })
    } else out.push({ ...m, raw: undefined })
  }
  flush()
  return out
}

const OPEN = '<tool_call>'
const CLOSE = '</tool_call>'

/** Extrae llamadas del texto en streaming; el texto fuera de los bloques se emite tal cual. */
export class ToolCallExtractor {
  private buf = ''
  private inside = false
  calls: ToolCall[] = []

  push(chunk: string): string {
    this.buf += chunk
    let visible = ''
    for (;;) {
      if (!this.inside) {
        const i = this.buf.indexOf(OPEN)
        if (i < 0) {
          // conserva un posible prefijo parcial de <tool_call>
          let keep = 0
          for (let k = Math.min(OPEN.length - 1, this.buf.length); k > 0; k--) {
            if (OPEN.startsWith(this.buf.slice(-k))) {
              keep = k
              break
            }
          }
          visible += this.buf.slice(0, this.buf.length - keep)
          this.buf = this.buf.slice(this.buf.length - keep)
          return visible
        }
        visible += this.buf.slice(0, i)
        this.buf = this.buf.slice(i + OPEN.length)
        this.inside = true
      } else {
        const j = this.buf.indexOf(CLOSE)
        if (j < 0) return visible
        this.addCall(this.buf.slice(0, j))
        this.buf = this.buf.slice(j + CLOSE.length)
        this.inside = false
      }
    }
  }

  finish(): string {
    const rest = this.inside ? '' : this.buf
    if (this.inside && this.buf.trim()) this.addCall(this.buf)
    this.buf = ''
    this.inside = false
    return rest
  }

  private addCall(raw: string) {
    const text = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim()
    const parsed = safeJsonParse<{ name?: string; arguments?: unknown; input?: unknown }>(text)
    if (parsed.ok && parsed.value?.name) {
      const args = parsed.value.arguments ?? parsed.value.input ?? {}
      const input = typeof args === 'string' ? safeJsonParse<Record<string, unknown>>(args) : { ok: true as const, value: args }
      if (input.ok && input.value && typeof input.value === 'object') {
        this.calls.push({ id: uid('ptc'), name: parsed.value.name, input: input.value as Record<string, unknown> })
        return
      }
    }
    this.calls.push({ id: uid('ptc'), name: parsed.ok ? (parsed.value?.name ?? 'unknown') : 'unknown', input: {}, rawArguments: text, parseError: parsed.ok ? 'missing arguments' : parsed.error })
  }
}

export function withPromptTools(inner: ProviderAdapter): ProviderAdapter {
  return {
    listModels: inner.listModels,
    async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
      if (!req.tools.length) {
        yield* inner.stream(req)
        return
      }
      const system = `${req.system}\n\n${promptToolInstructions(req.tools)}`
      const extractor = new ToolCallExtractor()
      for await (const ev of inner.stream({ ...req, system, tools: [], messages: toPromptMessages(req.messages) })) {
        if (ev.type === 'text') {
          const visible = extractor.push(ev.text)
          if (visible) yield { type: 'text', text: visible }
        } else if (ev.type === 'stop') {
          const rest = extractor.finish()
          if (rest) yield { type: 'text', text: rest }
          for (const call of extractor.calls) yield { type: 'tool_call', call }
          yield { type: 'stop', reason: extractor.calls.length ? 'tool_calls' : ev.reason }
        } else if (ev.type !== 'tool_call' && ev.type !== 'raw') {
          yield ev
        }
      }
    },
  }
}
