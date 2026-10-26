// Relay endurecido de ISC AGENT.
//
// Reenvía peticiones del navegador a proveedores que no permiten CORS, a
// WebFetch/WebSearch y a servidores MCP. Se usa desde la función de Vercel
// (exports GET/POST/...) y desde el middleware de Vite en desarrollo.
//
// Protecciones:
// - Token obligatorio en producción (HARNESS_ACCESS_TOKEN).
// - Anti-SSRF: la IP se valida en el momento de conectar (lookup propio), así
//   que un DNS que cambia entre comprobación y conexión no sirve de nada.
// - Redirecciones revalidadas una a una.
// - Lista blanca de cabeceras: nunca se reenvían cookies ni Origin/Referer.
// - Límites de tamaño y de tiempo.

import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { timingSafeEqual } from 'node:crypto'

export interface RelayOptions {
  env: Record<string, string | undefined>
  /** En desarrollo local el token es opcional. */
  dev?: boolean
}

const MAX_REQUEST_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024
const HARD_MAX_RESPONSE_BYTES = 50 * 1024 * 1024
const TIMEOUT_MS = 300_000
const MAX_REDIRECTS = 5

const FORWARD_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'authorization',
  'x-api-key',
  'api-key',
  'anthropic-version',
  'anthropic-beta',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
])

const FORWARD_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-language',
  'mcp-session-id',
  'retry-after',
  'x-request-id',
  'request-id',
])

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// ---------------------------------------------------------------------------
// Validación de direcciones IP
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

/** true si la IP no es una dirección pública enrutable. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return BLOCKED_V4.some(([base, bits]) => inV4Range(ip, base, bits))
  if (family === 6) {
    const lower = ip.toLowerCase()
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedAddress(mapped[1])
    if (lower === '::' || lower === '::1') return true
    if (/^fe[89ab]/.test(lower)) return true // link-local
    if (/^f[cd]/.test(lower)) return true // ULA
    if (/^ff/.test(lower)) return true // multicast
    if (lower.startsWith('64:ff9b:')) return true // NAT64
    if (lower.startsWith('2001:db8')) return true // documentación
    return false
  }
  return true
}

export function hostAllowed(hostname: string, allowList: string[]): boolean {
  if (allowList.length === 0) return true
  const host = hostname.toLowerCase()
  return allowList.some((entry) => {
    const e = entry.trim().toLowerCase()
    return e !== '' && (host === e || host.endsWith(`.${e}`))
  })
}

function makeSafeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return (callback as (e: Error | null) => void)(err)
      const list = addresses as LookupAddress[]
      const bad = list.find((a) => !allowPrivate && isBlockedAddress(a.address))
      if (bad || list.length === 0) {
        const e = new Error(`Dirección bloqueada por el relay (SSRF): ${hostname} → ${bad?.address ?? 'sin IP'}`)
        ;(e as NodeJS.ErrnoException).code = 'ERELAYBLOCKED'
        return (callback as (e: Error | null) => void)(e)
      }
      if ((options as { all?: boolean }).all) {
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list)
      }
      return callback(null, list[0].address, list[0].family)
    })
  }
}

// ---------------------------------------------------------------------------
// Petición saliente
// ---------------------------------------------------------------------------

interface Outgoing {
  url: URL
  method: string
  headers: Record<string, string>
  body?: Buffer
}

function send(req: Outgoing, lookup: LookupFunction, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const fn = req.url.protocol === 'https:' ? httpsRequest : httpRequest
    const r = fn(
      req.url,
      {
        method: req.method,
        headers: { ...req.headers, ...(req.body ? { 'content-length': String(req.body.length) } : {}) },
        lookup,
        signal,
      },
      resolve,
    )
    r.on('error', reject)
    if (req.body) r.write(req.body)
    r.end()
  })
}

function validateTarget(raw: string | null, allowList: string[]): URL | Response {
  if (!raw) return json(400, { error: 'Falta la cabecera x-relay-url' })
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return json(400, { error: 'URL de destino inválida' })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return json(400, { error: 'Solo se permiten URLs http(s)' })
  }
  if (url.username || url.password) return json(400, { error: 'No se permiten credenciales en la URL' })
  if (!hostAllowed(url.hostname, allowList)) {
    return json(403, { error: `Dominio no permitido por RELAY_ALLOWED_HOSTS: ${url.hostname}` })
  }
  return url
}

const CORS_ALLOWED_HEADERS = new Set([
  ...FORWARD_REQUEST_HEADERS,
  'x-relay-url',
  'x-harness-token',
  'x-relay-follow',
  'x-relay-max-bytes',
  'x-relay-ping',
])

/**
 * CORS opcional: solo para los orígenes listados en RELAY_ALLOWED_ORIGINS
 * (p. ej. https://usuario.github.io cuando la app está en GitHub Pages y el
 * relay en Vercel). Sin esa variable, el relay solo sirve a su propio origen.
 */
function corsHeaders(request: Request, env: RelayOptions['env']): Record<string, string> | null {
  const origin = request.headers.get('origin')
  if (!origin) return null
  const allowed = (env.RELAY_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (!allowed.includes(origin)) return null
  const requested = (request.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h && (CORS_ALLOWED_HEADERS.has(h) || h.startsWith('x-relay-header-')))
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
    'access-control-allow-headers': [...new Set([...CORS_ALLOWED_HEADERS, ...requested])].join(', '),
    'access-control-expose-headers': 'x-relay-final-url, mcp-session-id, retry-after, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

export async function handleRelay(request: Request, opts: RelayOptions): Promise<Response> {
  const cors = corsHeaders(request, opts.env)
  if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} })
  const res = await relay(request, opts)
  if (!cors) return res
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

async function relay(request: Request, opts: RelayOptions): Promise<Response> {
  const { env } = opts
  const token = env.HARNESS_ACCESS_TOKEN?.trim()
  if (!token && !opts.dev) {
    return json(503, {
      error: 'El relay está desactivado: configura HARNESS_ACCESS_TOKEN en las variables de entorno del despliegue.',
    })
  }
  if (token) {
    const given = request.headers.get('x-harness-token') ?? ''
    if (!safeEqual(given, token)) return json(401, { error: 'Token del relay inválido o ausente' })
  }

  // Sonda de la app para saber si hay relay (y si el token vale) sin generar un error.
  if (request.headers.get('x-relay-ping') && !request.headers.get('x-relay-url')) return json(200, { ok: true })

  const allowList = (env.RELAY_ALLOWED_HOSTS ?? '').split(',').filter((s) => s.trim() !== '')
  const allowPrivate = !!opts.dev && env.RELAY_ALLOW_PRIVATE === '1'
  const target = validateTarget(request.headers.get('x-relay-url'), allowList)
  if (target instanceof Response) return target
  if (!allowPrivate && isIP(target.hostname) && isBlockedAddress(target.hostname.replace(/^\[|\]$/g, ''))) {
    return json(403, { error: `Dirección bloqueada por el relay (SSRF): ${target.hostname}` })
  }
  if (!allowPrivate && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(target.hostname)) {
    return json(403, { error: `Dirección bloqueada por el relay (SSRF): ${target.hostname}` })
  }

  const headers: Record<string, string> = { 'user-agent': 'ISC-Agent-Relay/1.0' }
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (FORWARD_REQUEST_HEADERS.has(k)) headers[k] = value
    else if (k.startsWith('x-relay-header-')) {
      const name = k.slice('x-relay-header-'.length)
      if (!['cookie', 'host', 'origin', 'referer', 'content-length'].includes(name)) headers[name] = value
    }
  })

  let body: Buffer | undefined
  if (!['GET', 'HEAD'].includes(request.method)) {
    const ab = await request.arrayBuffer()
    if (ab.byteLength > MAX_REQUEST_BYTES) return json(413, { error: 'Cuerpo de la petición demasiado grande' })
    body = Buffer.from(ab)
  }

  const follow = request.headers.get('x-relay-follow') === '1'
  const maxBytes = Math.min(
    Number(request.headers.get('x-relay-max-bytes')) || DEFAULT_MAX_RESPONSE_BYTES,
    HARD_MAX_RESPONSE_BYTES,
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Tiempo de espera agotado')), TIMEOUT_MS)
  request.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  const lookup = makeSafeLookup(allowPrivate)

  let current: Outgoing = { url: target, method: request.method, headers, body }
  let upstream: IncomingMessage
  try {
    for (let hop = 0; ; hop++) {
      upstream = await send(current, lookup, controller.signal)
      const status = upstream.statusCode ?? 502
      const location = upstream.headers.location
      if (!follow || status < 300 || status >= 400 || !location) break
      upstream.resume()
      if (hop >= MAX_REDIRECTS) {
        clearTimeout(timer)
        return json(508, { error: 'Demasiadas redirecciones' })
      }
      const next = validateTarget(new URL(location, current.url).toString(), allowList)
      if (next instanceof Response) {
        clearTimeout(timer)
        return next
      }
      const keepBody = status === 307 || status === 308
      current = {
        url: next,
        method: keepBody ? current.method : 'GET',
        headers: next.origin === current.url.origin ? current.headers : { 'user-agent': headers['user-agent'] },
        body: keepBody ? current.body : undefined,
      }
    }
  } catch (err) {
    clearTimeout(timer)
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ERELAYBLOCKED') return json(403, { error: e.message })
    return json(502, { error: `No se pudo contactar con el destino: ${e.message}` })
  }

  const res = upstream!
  const outHeaders = new Headers({ 'cache-control': 'no-store', 'x-relay-final-url': current.url.toString() })
  for (const [k, v] of Object.entries(res.headers)) {
    const key = k.toLowerCase()
    if (v === undefined) continue
    if (FORWARD_RESPONSE_HEADERS.has(key) || key.startsWith('x-ratelimit') || key.startsWith('anthropic-ratelimit')) {
      outHeaders.set(key, Array.isArray(v) ? v.join(', ') : v)
    }
  }

  let received = 0
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > maxBytes) {
          ctrl.error(new Error('Respuesta demasiado grande para el relay'))
          res.destroy()
          clearTimeout(timer)
          return
        }
        ctrl.enqueue(new Uint8Array(chunk))
      })
      res.on('end', () => {
        clearTimeout(timer)
        ctrl.close()
      })
      res.on('error', (e) => {
        clearTimeout(timer)
        ctrl.error(e)
      })
    },
    cancel() {
      clearTimeout(timer)
      res.destroy()
    },
  })

  return new Response(request.method === 'HEAD' ? null : stream, {
    status: res.statusCode ?? 502,
    headers: outHeaders,
  })
}

// ---------------------------------------------------------------------------
// Función de Vercel
// ---------------------------------------------------------------------------

const vercel = (request: Request) => handleRelay(request, { env: process.env })

export const GET = vercel
export const POST = vercel
export const PUT = vercel
export const PATCH = vercel
export const DELETE = vercel
export const HEAD = vercel
export const OPTIONS = vercel
