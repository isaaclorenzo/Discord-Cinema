import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureNet, effectiveVia } from '../src/core/net'
import { quirksFor } from '../src/core/providers/compat'
import { explainProviderError } from '../src/core/providers/errors'
import { compatOpenAiAdapter } from '../src/core/providers/openai-compat'
import type { ProviderConfig, StreamEvent } from '../src/core/providers/types'
import { DEFAULT_TUNNEL_SERVER, isPrivateHost, normalizeTunnelServer, TunnelError, tunnelFetch } from '../src/core/tunnel'
import { DEFAULT_GUARD } from '../src/core/security/guard'

vi.mock('../src/core/tunnel', async (orig) => ({ ...(await orig<typeof import('../src/core/tunnel')>()), tunnelFetch: vi.fn() }))

const sseOk = () =>
  new Response(['{"choices":[{"delta":{"content":"ok"}}]}', '[DONE]'].map((d) => `data: ${d}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })

async function ask(p: ProviderConfig) {
  const out: StreamEvent[] = []
  const req = { provider: p, apiKey: 'k', model: p.models[0], system: '', messages: [{ id: '1', role: 'user' as const, content: 'hola', createdAt: 0 }], tools: [], params: {}, signal: new AbortController().signal }
  for await (const ev of compatOpenAiAdapter.stream(req)) out.push(ev)
  return out
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(tunnelFetch).mockReset()
})

function env(opts: { relay: 'ok' | 'missing'; tunnel: boolean }) {
  configureNet({
    relayToken: () => '',
    relayUrl: () => '/api/relay',
    guard: () => DEFAULT_GUARD,
    relayAvailable: () => opts.relay === 'ok',
    relayMissing: () => opts.relay === 'missing',
    tunnel: () => ({ enabled: opts.tunnel, server: DEFAULT_TUNNEL_SERVER }),
  })
}

describe('túnel cifrado', () => {
  it('normaliza el servidor y exige wss (ws solo en local)', () => {
    expect(normalizeTunnelServer('wss://wisp.example.com')).toBe('wss://wisp.example.com/')
    expect(normalizeTunnelServer('ws://localhost:6001')).toBe('ws://localhost:6001/')
    expect(() => normalizeTunnelServer('ws://wisp.example.com/')).toThrow(/wss/)
    expect(() => normalizeTunnelServer('https://wisp.example.com/')).toThrow(/wss/)
  })

  it('nunca abre túneles hacia la red local', () => {
    for (const h of ['localhost', 'printer.local', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '[::1]', 'fd00::1']) {
      expect(isPrivateHost(h), h).toBe(true)
    }
    for (const h of ['api.deepseek.com', '8.8.8.8', '172.32.0.1', 'example.com']) expect(isPrivateHost(h), h).toBe(false)
  })

  it('sustituye el relay ausente por el túnel, y el túnel apagado por directa', () => {
    env({ relay: 'missing', tunnel: true })
    expect(effectiveVia('relay')).toBe('tunnel')
    expect(effectiveVia('direct')).toBe('direct')
    env({ relay: 'ok', tunnel: true })
    expect(effectiveVia('relay')).toBe('relay')
    env({ relay: 'missing', tunnel: false })
    expect(effectiveVia('relay')).toBe('relay')
    expect(effectiveVia('tunnel')).toBe('direct')
  })

  it('explica los fallos del túnel sin confundirlos con CORS', () => {
    expect(explainProviderError('El túnel rechazó la conexión segura con api.x.com: el certificado no es válido (SSL). No se envió nada.').title).toBe('Conexión segura rechazada')
    expect(explainProviderError('No se pudo conectar por el túnel cifrado (wisp.example.com): timeout').title).toBe('El túnel cifrado no respondió')
    expect(explainProviderError('Failed to fetch (posible bloqueo CORS: prueba la conexión «Túnel cifrado» o «Relay» para este proveedor)').title).toBe('No se pudo conectar')
  })

  it('sin relay, un proveedor «por relay» prueba en directo y luego el túnel, y lo recuerda', async () => {
    env({ relay: 'missing', tunnel: true })
    const direct = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', direct)
    vi.mocked(tunnelFetch).mockResolvedValue({ res: sseOk(), finalUrl: 'https://api.sincors.test/v1/chat/completions' })
    const p: ProviderConfig = { id: 'sincors', name: 'Sin CORS', kind: 'openai', baseUrl: 'https://api.sincors.test/v1', connection: 'relay', models: [{ id: 'm', toolMode: 'native' }], enabled: true }
    const ev = await ask(p)
    expect(ev.find((e) => e.type === 'text')).toEqual({ type: 'text', text: 'ok' })
    expect(direct.mock.calls[0][0]).toBe('https://api.sincors.test/v1/chat/completions')
    expect(vi.mocked(tunnelFetch).mock.calls[0][0]).toBe('https://api.sincors.test/v1/chat/completions')
    expect(quirksFor(p.id, 'm').connection).toBe('tunnel')
  })

  it('un certificado inválido en el túnel nunca cae a otra conexión', async () => {
    env({ relay: 'missing', tunnel: true })
    const direct = vi.fn()
    vi.stubGlobal('fetch', direct)
    vi.mocked(tunnelFetch).mockRejectedValue(new TunnelError('El túnel rechazó la conexión segura con x: el certificado no es válido'))
    const p: ProviderConfig = { id: 'mitm', name: 'MITM', kind: 'openai', baseUrl: 'https://api.mitm.test/v1', connection: 'tunnel', models: [{ id: 'm', toolMode: 'native' }], enabled: true }
    await expect(ask(p)).rejects.toThrow(/certificado no es válido/)
    expect(direct).not.toHaveBeenCalled()
    expect(vi.mocked(tunnelFetch)).toHaveBeenCalledTimes(1)
  })
})
