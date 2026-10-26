// Túnel cifrado de extremo a extremo para proveedores que bloquean el navegador
// (sin CORS) cuando no hay relay propio, p. ej. en GitHub Pages.
//
// libcurl.js ejecuta curl + TLS dentro de WebAssembly: el navegador hace el
// handshake TLS con el proveedor y verifica su certificado contra el bundle de
// Mozilla. El servidor del túnel (protocolo Wisp sobre WebSocket) solo reenvía
// bytes cifrados: no puede leer ni modificar claves, mensajes ni respuestas.
// Sí ve a qué host:puerto te conectas y tu IP, como cualquier proveedor de red.

import type { HttpSession, LibcurlApi } from 'libcurl.js'

export const DEFAULT_TUNNEL_SERVER = 'wss://wisp.mercurywork.shop/'

let loading: Promise<LibcurlApi> | null = null
// Una sesión (con su propio pool de conexiones) por servidor: al cambiar de
// servidor se cierran las conexiones del anterior en vez de seguir usándolas.
let session: { server: string; http: HttpSession } | null = null

async function load(): Promise<LibcurlApi> {
  loading ??= (async () => {
    const [{ libcurl }, { default: wasmUrl }] = await Promise.all([import('libcurl.js'), import('libcurl.js/libcurl.wasm?url')])
    // Silencia la salida de curl en la consola; los errores llegan como excepciones.
    libcurl.stdout = () => {}
    libcurl.stderr = () => {}
    libcurl.logger = (type, text) => type === 'error' && console.warn('[isc-agent] túnel:', text)
    await libcurl.load_wasm(wasmUrl)
    return libcurl
  })().catch((e) => {
    loading = null
    throw e
  })
  return loading
}

export function normalizeTunnelServer(raw: string): string {
  const url = new URL(raw.trim())
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('El servidor del túnel debe ser una URL wss://')
  if (url.protocol === 'ws:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) throw new Error('Usa wss:// (ws:// solo para localhost)')
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?(::1?|f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*)\]?$/i,
]

/** El túnel es para hosts públicos de internet, nunca para la red local. */
export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST.some((r) => r.test(hostname))
}

export class TunnelError extends Error {}

const CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'api-key', 'cookie', 'proxy-authorization']

/**
 * fetch a través del túnel. Admite streaming de la respuesta y AbortSignal.
 * Las redirecciones se resuelven aquí (no en curl) para poder revalidar el destino.
 */
export async function tunnelFetch(url: string, init: RequestInit, server: string, opts: { allowPrivate?: boolean; follow?: boolean } = {}): Promise<{ res: Response; finalUrl: string }> {
  const libcurl = await load().catch((e) => {
    throw new TunnelError(`No se pudo cargar el túnel cifrado: ${(e as Error).message}`)
  })
  if (session?.server !== server) {
    session?.http.close()
    libcurl.set_websocket(server)
    session = { server, http: new libcurl.HTTPSession() }
  }
  const http = session.http
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((v, k) => (headers[k] = v))
  let target = new URL(url)
  for (let hop = 0; hop < 6; hop++) {
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new TunnelError('El túnel solo admite http(s)')
    if (!opts.allowPrivate && isPrivateHost(target.hostname)) throw new TunnelError(`El túnel no se conecta a direcciones locales (${target.hostname})`)
    let res: Response
    try {
      res = await http.fetch(target.href, { method: init.method ?? 'GET', headers, body: init.body ?? undefined, signal: init.signal ?? undefined, redirect: 'manual' })
    } catch (e) {
      if ((e as Error).name === 'AbortError' || init.signal?.aborted) throw e
      const msg = (e as Error).message
      if (/certificate|SSL|TLS|peer|verify/i.test(msg)) {
        throw new TunnelError(`El túnel rechazó la conexión segura con ${target.hostname}: el certificado no es válido (${msg}). No se envió nada.`)
      }
      throw new TunnelError(`No se pudo conectar por el túnel cifrado (${new URL(server).host}): ${msg}`)
    }
    const location = res.headers.get('location')
    if (!opts.follow || res.status < 300 || res.status >= 400 || !location) return { res, finalUrl: target.href }
    const next = new URL(location, target)
    // Como hace el navegador: las credenciales no siguen a otro origen.
    if (next.origin !== target.origin) for (const h of CREDENTIAL_HEADERS) delete headers[h]
    target = next
    if (res.status !== 307 && res.status !== 308) init = { ...init, method: 'GET', body: undefined }
  }
  throw new TunnelError('Demasiadas redirecciones')
}
