import { describe, expect, it } from 'vitest'
import { handleRelay, hostAllowed, isBlockedAddress } from '../api/relay'

function req(url: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/relay', { method: 'GET', headers: { 'x-relay-url': url, ...headers } })
}

describe('relay', () => {
  it('bloquea direcciones privadas y especiales', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false)
  })

  it('respeta la lista de dominios permitidos', () => {
    expect(hostAllowed('api.deepseek.com', [])).toBe(true)
    expect(hostAllowed('api.deepseek.com', ['deepseek.com'])).toBe(true)
    expect(hostAllowed('evil.com', ['deepseek.com'])).toBe(false)
    expect(hostAllowed('deepseek.com.evil.com', ['deepseek.com'])).toBe(false)
  })

  it('exige token en producción', async () => {
    const off = await handleRelay(req('https://example.com'), { env: {} })
    expect(off.status).toBe(503)
    const bad = await handleRelay(req('https://example.com', { 'x-harness-token': 'nope' }), { env: { HARNESS_ACCESS_TOKEN: 'secreto' } })
    expect(bad.status).toBe(401)
  })

  it('rechaza destinos internos (SSRF)', async () => {
    const opts = { env: { HARNESS_ACCESS_TOKEN: 't' } }
    const h = { 'x-harness-token': 't' }
    expect((await handleRelay(req('http://127.0.0.1:8080/', h), opts)).status).toBe(403)
    expect((await handleRelay(req('http://localhost/', h), opts)).status).toBe(403)
    expect((await handleRelay(req('http://169.254.169.254/latest/meta-data', h), opts)).status).toBe(403)
    expect((await handleRelay(req('file:///etc/passwd', h), opts)).status).toBe(400)
    expect((await handleRelay(req('https://user:pw@example.com', h), opts)).status).toBe(400)
  })
})

describe('CORS del relay', () => {
  const env = { HARNESS_ACCESS_TOKEN: 't', RELAY_ALLOWED_ORIGINS: 'https://isaaclorenzo.github.io' }
  it('responde al preflight solo para orígenes permitidos', async () => {
    const ok = await handleRelay(
      new Request('http://x/api/relay', { method: 'OPTIONS', headers: { origin: 'https://isaaclorenzo.github.io', 'access-control-request-headers': 'x-relay-url, x-relay-header-x-title, cookie' } }),
      { env },
    )
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://isaaclorenzo.github.io')
    expect(ok.headers.get('access-control-allow-headers')).toContain('x-relay-header-x-title')
    expect(ok.headers.get('access-control-allow-headers')).not.toContain('cookie')
    const bad = await handleRelay(new Request('http://x/api/relay', { method: 'OPTIONS', headers: { origin: 'https://evil.com' } }), { env })
    expect(bad.status).toBe(403)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('añade cabeceras CORS también a los errores', async () => {
    const r = await handleRelay(req('https://example.com', { origin: 'https://isaaclorenzo.github.io' }), { env })
    expect(r.status).toBe(401)
    expect(r.headers.get('access-control-allow-origin')).toBe('https://isaaclorenzo.github.io')
  })
})
