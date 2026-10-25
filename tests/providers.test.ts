import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAiAdapter } from '../src/core/providers/openai-compat'
import { ThinkSplitter } from '../src/core/providers/sse'
import { ToolCallExtractor } from '../src/core/providers/prompt-tools'
import { providerFromPreset, PRESETS } from '../src/core/providers/presets'
import type { StreamEvent } from '../src/core/providers/types'
import { scanText, DEFAULT_GUARD, redactText } from '../src/core/security/guard'

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('')
  const bytes = new TextEncoder().encode(body)
  // Se parte en trozos irregulares para probar el parser incremental.
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (let i = 0; i < bytes.length; i += 7) ctrl.enqueue(bytes.slice(i, i + 7))
      ctrl.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('adaptador OpenAI-compatible', () => {
  it('parsea razonamiento, texto, tool_calls y usage', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { choices: [{ delta: { reasoning_content: 'pienso…' } }] },
        { choices: [{ delta: { content: 'Hola ' } }] },
        { choices: [{ delta: { content: 'mundo', tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{"file_' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'path":"a.txt"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        '[DONE]',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = { ...providerFromPreset(PRESETS.find((p) => p.id === 'deepseek')!, 'ds'), connection: 'direct' as const }
    const events: StreamEvent[] = []
    for await (const ev of openAiAdapter.stream({
      provider,
      apiKey: 'k',
      model: provider.models[0],
      system: 'sys',
      messages: [{ id: '1', role: 'user', content: 'hola', createdAt: 0 }],
      tools: [{ name: 'Read', description: 'r', inputSchema: { type: 'object' } }],
      params: { temperature: 0.2 },
      signal: new AbortController().signal,
    }))
      events.push(ev)
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')
    expect(text).toBe('Hola mundo')
    expect(events.find((e) => e.type === 'reasoning')).toEqual({ type: 'reasoning', text: 'pienso…' })
    expect(events.find((e) => e.type === 'tool_call')).toEqual({ type: 'tool_call', call: { id: 'c1', name: 'Read', input: { file_path: 'a.txt' } } })
    expect(events.find((e) => e.type === 'usage')).toEqual({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: undefined, cachedTokens: undefined } })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.tools[0].function.name).toBe('Read')
    expect(body.temperature).toBe(0.2)
  })

  it('informa errores HTTP con el mensaje del proveedor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 })))
    const provider = { ...providerFromPreset(PRESETS.find((p) => p.id === 'deepseek')!, 'ds'), connection: 'direct' as const }
    const gen = openAiAdapter.stream({
      provider,
      apiKey: 'bad',
      model: provider.models[0],
      system: '',
      messages: [],
      tools: [],
      params: {},
      signal: new AbortController().signal,
    })
    await expect(gen.next()).rejects.toThrow(/401: Invalid API key/)
  })
})

describe('separadores de streaming', () => {
  it('ThinkSplitter separa <think> al inicio', () => {
    const s = new ThinkSplitter()
    const out = [...s.push('<thi'), ...s.push('nk>razono</th'), ...s.push('ink>\nrespuesta <think> literal'), ...s.flush()]
    const reasoning = out.filter((o) => o.type === 'reasoning').map((o) => o.text).join('')
    const text = out.filter((o) => o.type === 'text').map((o) => o.text).join('')
    expect(reasoning).toBe('razono')
    expect(text).toBe('respuesta <think> literal')
  })

  it('ToolCallExtractor extrae llamadas por prompt', () => {
    const x = new ToolCallExtractor()
    let visible = x.push('Voy a leer <tool_')
    visible += x.push('call>{"name":"Read","arguments":{"file_path":"a"}}</tool_call> listo')
    visible += x.finish()
    expect(visible).toBe('Voy a leer  listo')
    expect(x.calls[0].name).toBe('Read')
    expect(x.calls[0].input).toEqual({ file_path: 'a' })
  })
})

describe('detectores del guard', () => {
  it('detecta secretos y datos personales', () => {
    const t = [
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_' + 'a'.repeat(36),
      'tarjeta 4111 1111 1111 1111',
      'iban ES91 2100 0418 4502 0005 1332',
      'tel +34 612 345 678',
      'password = "hunter2hunter2"',
      'postgres://admin:s3cret@db.example.com/x',
    ].join('\n')
    const ids = new Set(scanText(t, DEFAULT_GUARD).map((f) => f.detector))
    for (const id of ['aws-key', 'github-token', 'credit-card', 'iban', 'phone', 'secret-assignment', 'connection-string']) expect(ids, id).toContain(id)
  })
  it('no da falsos positivos obvios', () => {
    expect(scanText('el número 1234 5678 9012 3456 no pasa Luhn; versión 1.2.3; user@example.com', DEFAULT_GUARD)).toEqual([])
  })
  it('términos propios y redacción', () => {
    const cfg = { ...DEFAULT_GUARD, customTerms: ['Acme Corp'] }
    expect(redactText('trabajo en acme corp', cfg).text).toBe('trabajo en [REDACTED:custom]')
  })
})
