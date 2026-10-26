// Capa de red única de la harness. Toda petición saliente pasa por aquí:
// - aplica el guard de privacidad al cuerpo y a la URL,
// - decide si va directa, por el relay propio o por el túnel cifrado,
// - y la registra en el inspector de red.

import type { Connection } from './providers/types'
import { DEFAULT_GUARD, GuardBlockedError, guardPayload, scanText, type GuardConfig } from './security/guard'
import { useNetlog, type NetPurpose } from './security/netlog'
import { tunnelFetch } from './tunnel'

export interface NetEnv {
  relayToken: () => string
  /** URL del relay (por defecto, /api/relay del propio despliegue). */
  relayUrl: () => string
  guard: () => GuardConfig
  /** ¿Hay un relay utilizable? (para cambiar de conexión automáticamente) */
  relayAvailable?: () => boolean
  /** ¿Consta que no hay relay (p. ej. GitHub Pages)? */
  relayMissing?: () => boolean
  /** Túnel cifrado: activado y URL del servidor Wisp. */
  tunnel?: () => { enabled: boolean; server: string }
}

let env: NetEnv = { relayToken: () => '', relayUrl: () => '/api/relay', guard: () => DEFAULT_GUARD }

export function relayAvailable(): boolean {
  return env.relayAvailable?.() ?? false
}

export function configureNet(next: NetEnv): void {
  env = next
}

export function relayMissing(): boolean {
  return env.relayMissing?.() ?? false
}

export function tunnelEnabled(): boolean {
  return env.tunnel?.().enabled ?? false
}

/** Conexión real: el relay ausente se sustituye por el túnel; el túnel apagado, por directa. */
export function effectiveVia(via: Connection): Connection {
  if (via === 'relay' && env.relayMissing?.() && tunnelEnabled()) return 'tunnel'
  if (via === 'tunnel' && !tunnelEnabled()) return 'direct'
  return via
}

const NULL_BODY = new Set([101, 103, 204, 205, 304])

/** Respuesta del túnel con límite de tamaño y la URL final (como hace el relay). */
function wrapTunnelResponse(res: Response, finalUrl: string, maxBytes?: number): Response {
  if (!res.body || NULL_BODY.has(res.status)) return res
  let body = res.body as ReadableStream<Uint8Array>
  if (maxBytes) {
    let seen = 0
    body = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          seen += chunk.byteLength
          if (seen > maxBytes) ctl.error(new Error(`Respuesta demasiado grande (más de ${maxBytes} bytes)`))
          else ctl.enqueue(chunk)
        },
      }),
    )
  }
  const headers = new Headers(res.headers)
  headers.set('x-relay-final-url', finalUrl)
  return new Response(body, { status: res.status, statusText: res.statusText, headers })
}

export interface NetOptions {
  purpose: NetPurpose
  label: string
  via: Connection
  /** Aplicar el guard al cuerpo/URL (por defecto sí). */
  guard?: boolean
  /** Seguir redirecciones en el relay. */
  follow?: boolean
  maxBytes?: number
  /** Número de redacciones ya aplicadas antes (p. ej. en el bucle de agente). */
  priorRedactions?: number
}

const RELAY_FORWARDED = new Set([
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

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  new Headers(h).forEach((v, k) => (out[k] = v))
  return out
}

function bodyToString(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return undefined
}

export async function netFetch(url: string, init: RequestInit, opts: NetOptions): Promise<Response> {
  opts = { ...opts, via: effectiveVia(opts.via) }
  const log = useNetlog.getState()
  const method = (init.method ?? 'GET').toUpperCase()
  let body = init.body
  const bodyText = bodyToString(body)
  let redactions = opts.priorRedactions ?? 0

  if (opts.guard !== false) {
    const cfg = env.guard()
    const urlFindings = scanText(decodeURIComponent(url), cfg, 'url')
    let bodyFindings: ReturnType<typeof scanText> = []
    let parsed: unknown
    if (bodyText) {
      try {
        parsed = JSON.parse(bodyText)
      } catch {
        parsed = undefined
      }
      bodyFindings = parsed !== undefined ? guardPayload(parsed, cfg, 'scan').findings : scanText(bodyText, cfg, 'body')
    }
    const all = [...urlFindings, ...bodyFindings]
    if (all.length && cfg.action !== 'warn') {
      // La URL nunca se redacta: un secreto en la URL siempre bloquea.
      if (cfg.action === 'block' || urlFindings.length) {
        log.add({
          purpose: opts.purpose,
          label: opts.label,
          method,
          url,
          via: opts.via,
          requestBytes: bodyText?.length ?? 0,
          requestBody: bodyText,
          redactions: 0,
          blocked: true,
          error: 'Bloqueado por el escudo de privacidad',
        })
        throw new GuardBlockedError(all, opts.label)
      }
      if (cfg.action === 'redact' && parsed !== undefined) {
        const r = guardPayload(parsed, cfg, 'redact')
        body = JSON.stringify(r.payload)
        redactions += r.findings.length
      } else if (cfg.action === 'redact' && bodyText) {
        throw new GuardBlockedError(all, opts.label)
      }
    }
  }

  const finalBody = typeof body === 'string' ? body : bodyToString(body)
  const id = log.add({
    purpose: opts.purpose,
    label: opts.label,
    method,
    url,
    via: opts.via,
    requestBytes: finalBody?.length ?? 0,
    requestBody: finalBody,
    redactions,
  })
  const started = performance.now()

  let target = url
  let reqInit: RequestInit = { ...init, body }
  if (opts.via === 'relay') {
    const original = headersToRecord(init.headers)
    const headers: Record<string, string> = { 'x-relay-url': url }
    for (const [k, v] of Object.entries(original)) {
      const key = k.toLowerCase()
      if (RELAY_FORWARDED.has(key)) headers[key] = v
      else if (key !== 'anthropic-dangerous-direct-browser-access') headers[`x-relay-header-${key}`] = v
    }
    const token = env.relayToken()
    if (token) headers['x-harness-token'] = token
    if (opts.follow) headers['x-relay-follow'] = '1'
    if (opts.maxBytes) headers['x-relay-max-bytes'] = String(opts.maxBytes)
    target = env.relayUrl()
    reqInit = { ...init, body, headers, credentials: 'omit' }
  } else {
    reqInit = { ...reqInit, credentials: 'omit', referrerPolicy: 'no-referrer' }
  }

  if (opts.via === 'tunnel') {
    const server = env.tunnel?.().server ?? ''
    try {
      const { res, finalUrl } = await tunnelFetch(url, { ...init, body }, server, { follow: opts.follow, allowPrivate: opts.purpose === 'llm' || opts.purpose === 'models' })
      log.update(id, { status: res.status, durationMs: Math.round(performance.now() - started) })
      return wrapTunnelResponse(res, finalUrl, opts.maxBytes)
    } catch (e) {
      log.update(id, { error: (e as Error).message, durationMs: Math.round(performance.now() - started) })
      throw e
    }
  }

  try {
    const res = await fetch(target, reqInit)
    log.update(id, { status: res.status, durationMs: Math.round(performance.now() - started) })
    if (opts.via === 'relay' && (res.status === 404 || res.status === 405) && !res.headers.get('x-relay-final-url')) {
      const msg = 'No hay relay en este despliegue (p. ej. GitHub Pages). Usa conexión «Directa» o «Túnel cifrado», o configura la URL de un relay en Seguridad.'
      log.update(id, { error: msg })
      throw new Error(msg)
    }
    if (opts.via === 'relay' && res.status >= 400 && res.headers.get('content-type')?.includes('application/json') && !res.headers.get('x-relay-final-url')) {
      // Error del propio relay (no del destino): se muestra claro.
      const data = (await res.clone().json().catch(() => null)) as { error?: string } | null
      if (data?.error) log.update(id, { error: `Relay: ${data.error}` })
    }
    return res
  } catch (e) {
    const msg = (e as Error).message
    const hint =
      opts.via === 'direct' && /Failed to fetch|NetworkError|Load failed/i.test(msg)
        ? ' (posible bloqueo CORS: prueba la conexión «Túnel cifrado» o «Relay» para este proveedor)'
        : ''
    log.update(id, { error: `${msg}${hint}`, durationMs: Math.round(performance.now() - started) })
    if (hint) throw new Error(`${msg}${hint}`)
    throw e
  }
}

/** fetch compatible con SDKs (p. ej. @anthropic-ai/sdk) que pasa por netFetch. */
export function makeSdkFetch(opts: NetOptions): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return netFetch(url, init ?? {}, opts)
  }
}
