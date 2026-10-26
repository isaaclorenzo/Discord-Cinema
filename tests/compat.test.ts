import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureNet } from '../src/core/net'
import { diagnoseRejection, endpointUrl, forgetQuirks, isAccountIssue, quirksFor } from '../src/core/providers/compat'
import { detectProvider, normalizeBaseUrl } from '../src/core/providers/detect'
import { compatOpenAiAdapter } from '../src/core/providers/openai-compat'
import type { ProviderConfig, StreamEvent, StreamRequest } from '../src/core/providers/types'
import { DEFAULT_GUARD } from '../src/core/security/guard'

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const OK = () => sse([{ choices: [{ delta: { content: 'ok' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]'])

let n = 0
function provider(extra: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id: `p${++n}`, name: 'Prov', kind: 'openai', baseUrl: 'https://api.prov.test/v1', connection: 'direct', models: [{ id: 'm1', toolMode: 'native' }], enabled: true, ...extra }
}

function request(p: ProviderConfig, tools = true): StreamRequest {
  return {
    provider: p,
    apiKey: 'k',
    model: p.models[0],
    system: 'sys',
    messages: [{ id: '1', role: 'user', content: 'hola', createdAt: 0 }],
    tools: tools ? [{ name: 'Read', description: 'Read a file', inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } } }] : [],
    params: { temperature: 0.3, maxTokens: 100 },
    signal: new AbortController().signal,
  }
}

async function collect(req: StreamRequest) {
  const out: StreamEvent[] = []
  for await (const ev of compatOpenAiAdapter.stream(req)) out.push(ev)
  return out
}
const bodies = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => JSON.parse(((c as unknown as [string, RequestInit])[1].body as string) ?? '{}'))

afterEach(() => vi.unstubAllGlobals())

describe('capa de compatibilidad universal', () => {
  it('quita parámetros que el proveedor rechaza y lo recuerda', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(400, { error: { message: "Unrecognized request argument supplied: stream_options" } })).mockResolvedValueOnce(json(422, { detail: [{ loc: ['body', 'temperature'], msg: 'extra fields not permitted' }] })).mockResolvedValue(OK())
    vi.stubGlobal('fetch', f)
    const p = provider()
    const ev = await collect(request(p, false))
    expect(ev.find((e) => e.type === 'text')).toEqual({ type: 'text', text: 'ok' })
    const b = bodies(f)
    expect(b[0].stream_options).toBeDefined()
    expect(b[1].stream_options).toBeUndefined()
    expect(b[2].temperature).toBeUndefined()
    expect(quirksFor(p.id, 'm1').drop).toEqual(['stream_options', 'temperature'])
  })

  it('cambia a herramientas por prompt si el modelo no las admite', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(400, { error: { message: 'This model does not support tools' } })).mockResolvedValue(
      sse([{ choices: [{ delta: { content: 'Leo <tool_call>{"name":"Read","arguments":{"file_path":"a"}}</tool_call>' } }] }, '[DONE]']),
    )
    vi.stubGlobal('fetch', f)
    const p = provider()
    const ev = await collect(request(p))
    expect(ev.find((e) => e.type === 'tool_call')).toMatchObject({ call: { name: 'Read', input: { file_path: 'a' } } })
    const b = bodies(f)
    expect(b[1].tools).toBeUndefined()
    expect(b[1].messages[0].content).toContain('Tool use protocol')
    expect(quirksFor(p.id, 'm1').promptTools).toBe(true)
  })

  it('usa max_completion_tokens cuando el proveedor lo pide', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } })).mockResolvedValue(OK())
    vi.stubGlobal('fetch', f)
    await collect(request(provider(), false))
    const b = bodies(f)
    expect(b[1].max_tokens).toBeUndefined()
    expect(b[1].max_completion_tokens).toBe(100)
  })

  it('acepta respuestas sin streaming', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(400, { error: { message: 'Streaming is not supported for this model' } })).mockResolvedValue(
      json(200, { choices: [{ message: { content: 'completo', tool_calls: [{ id: 't', function: { name: 'Read', arguments: '{"file_path":"x"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    )
    vi.stubGlobal('fetch', f)
    const ev = await collect(request(provider()))
    expect(bodies(f)[1].stream).toBe(false)
    expect(ev.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toBe('completo')
    expect(ev.find((e) => e.type === 'tool_call')).toMatchObject({ call: { name: 'Read' } })
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ usage: { inputTokens: 3, outputTokens: 2 } })
  })

  it('reintenta límites temporales respetando Retry-After', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '0' })).mockResolvedValue(OK())
    vi.stubGlobal('fetch', f)
    await collect(request(provider(), false))
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('no reintenta ni "arregla" restricciones de cuenta', async () => {
    const f = vi.fn().mockResolvedValue(json(429, { error: { message: 'Free models are not available to this account yet. Add credits to use paid access.' } }))
    vi.stubGlobal('fetch', f)
    await expect(collect(request(provider(), false))).rejects.toThrow(/restricción de la cuenta/)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('prueba otra cabecera de autenticación y añade /v1 si falta', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(404, { error: 'Not found' })).mockResolvedValueOnce(json(401, { error: 'Unauthorized' })).mockResolvedValue(OK())
    vi.stubGlobal('fetch', f)
    const p = provider({ baseUrl: 'https://llm.example.test' })
    await collect(request(p, false))
    const urls = f.mock.calls.map((c) => c[0])
    expect(urls[0]).toBe('https://llm.example.test/chat/completions')
    expect(urls[1]).toBe('https://llm.example.test/v1/chat/completions')
    const h = (f.mock.calls[2] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(h['api-key']).toBe('k')
    expect(h.authorization).toBe('Bearer k')
    forgetQuirks(p.id)
  })

  it('cambia a relay si la conexión directa falla por CORS', async () => {
    configureNet({ relayToken: () => '', relayUrl: () => '/api/relay', guard: () => DEFAULT_GUARD, relayAvailable: () => true })
    const f = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(OK())
    vi.stubGlobal('fetch', f)
    const p = provider()
    await collect(request(p, false))
    expect(f.mock.calls[1][0]).toBe('/api/relay')
    expect(quirksFor(p.id, 'otro').connection).toBe('relay')
    configureNet({ relayToken: () => '', relayUrl: () => '/api/relay', guard: () => DEFAULT_GUARD })
  })

  it('detecta un proveedor desconocido a partir de su URL', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(404, {})).mockResolvedValue(json(200, { data: [{ id: 'modelo-b' }, { id: 'modelo-a' }] }))
    vi.stubGlobal('fetch', f)
    const r = await detectProvider('llm.example.org/chat/completions', 'k', 'detect1')
    expect(r.provider.baseUrl).toBe('https://llm.example.org')
    expect(r.provider.quirks?.baseSuffix).toBe('/v1')
    expect(r.provider.models.map((m) => m.id)).toEqual(['modelo-a', 'modelo-b'])
    expect(r.provider.name).toBe('llm.example.org')
  })
})

describe('utilidades de compatibilidad', () => {
  it('construye endpoints con query y rutas completas', () => {
    expect(endpointUrl('https://x.openai.azure.com/openai/deployments/gpt?api-version=2024-10-21', '/chat/completions')).toBe('https://x.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-10-21')
    expect(endpointUrl('https://a.test/v1/chat/completions', '/chat/completions')).toBe('https://a.test/v1/chat/completions')
    expect(endpointUrl('https://a.test/', '/models', '/v1')).toBe('https://a.test/v1/models')
    expect(normalizeBaseUrl('localhost:11434/v1/')).toBe('http://localhost:11434/v1')
  })
  it('distingue rechazos de cuenta y diagnostica parámetros', () => {
    expect(isAccountIssue('Insufficient balance')).toBe(true)
    expect(diagnoseRejection(400, 'tool_choice is not supported', { tool_choice: 'auto', tools: [] }, { baseUrl: 'https://a/v1' })).toEqual({ dropParam: 'tool_choice' })
    expect(diagnoseRejection(400, 'Function calling is not enabled for this model', { tools: [1] }, { baseUrl: 'https://a/v1' })).toEqual({ promptTools: true })
    expect(diagnoseRejection(400, 'Insufficient credits', { temperature: 1 }, { baseUrl: 'https://a/v1' })).toBeNull()
    expect(diagnoseRejection(401, 'Incorrect API key provided', {}, { baseUrl: 'https://a/v1' })).toBeNull()
  })
})
