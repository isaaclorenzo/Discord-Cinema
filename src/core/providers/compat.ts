// Capa de compatibilidad universal para APIs "compatibles con OpenAI".
//
// Cada proveedor implementa el estándar a su manera: unos rechazan
// stream_options o tool_choice, otros piden max_completion_tokens, otros no
// soportan herramientas nativas o streaming, otros usan otra cabecera de
// autenticación o una ruta sin /v1. En lugar de fallar, la harness
// diagnostica el rechazo, corrige la petición y reintenta (como drop_params de
// LiteLLM), y recuerda lo aprendido para ese modelo.
//
// Lo que NO hace: saltarse restricciones de cuenta del proveedor (planes,
// créditos, verificación). Esos rechazos se informan tal cual, sin reintentos.

export interface ProviderQuirks {
  /** Parámetros opcionales que el proveedor rechaza. */
  drop?: string[]
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens'
  /** El proveedor no soporta streaming. */
  noStream?: boolean
  /** El modelo no soporta herramientas nativas: usar tool-calling por prompt. */
  promptTools?: boolean
  /** Enviar la clave también como api-key / x-api-key (Azure y otros). */
  authAll?: boolean
  /** Sufijo de ruta que faltaba en la URL base (p. ej. /v1). */
  baseSuffix?: string
  /** Conexión que funcionó (directa o relay). */
  connection?: 'direct' | 'relay'
}

export type QuirkFix = Partial<ProviderQuirks> & { dropParam?: string }

/** Parámetros que se pueden quitar sin cambiar lo esencial de la petición. */
export const OPTIONAL_PARAMS = ['stream_options', 'tool_choice', 'reasoning_effort', 'temperature', 'top_p', 'parallel_tool_calls', 'max_tokens', 'max_completion_tokens']

const learned = new Map<string, ProviderQuirks>()
let listener: ((providerId: string, modelId: string, quirks: ProviderQuirks, fix: QuirkFix) => void) | null = null

export function forgetQuirks(providerId: string): void {
  for (const k of [...learned.keys()]) if (k.startsWith(`${providerId}::`)) learned.delete(k)
}

export function setCompatListener(fn: typeof listener): void {
  listener = fn
}

/** Ajustes que valen para todo el proveedor (no solo para un modelo). */
const PROVIDER_LEVEL = ['authAll', 'baseSuffix', 'connection'] as const

export function quirksFor(providerId: string, modelId: string, storedModel?: ProviderQuirks, storedProvider?: ProviderQuirks): ProviderQuirks {
  const memP = learned.get(`${providerId}::*`)
  const memM = learned.get(`${providerId}::${modelId}`)
  const merged: ProviderQuirks = { ...(storedProvider ?? {}), ...(memP ?? {}), ...(storedModel ?? {}), ...(memM ?? {}) }
  for (const k of PROVIDER_LEVEL) {
    const v = memP?.[k] ?? storedProvider?.[k]
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v
  }
  merged.drop = [...new Set([...(storedModel?.drop ?? []), ...(memM?.drop ?? [])])]
  return merged
}

export function learn(providerId: string, modelId: string, current: ProviderQuirks, fix: QuirkFix): ProviderQuirks {
  const next: ProviderQuirks = { ...current }
  if (fix.dropParam) next.drop = [...new Set([...(current.drop ?? []), fix.dropParam])]
  for (const k of ['maxTokensParam', 'noStream', 'promptTools', 'authAll', 'baseSuffix', 'connection'] as const) {
    if (fix[k] !== undefined) (next as Record<string, unknown>)[k] = fix[k]
  }
  const providerLevel = PROVIDER_LEVEL.some((k) => fix[k] !== undefined)
  const key = `${providerId}::${providerLevel ? '*' : modelId}`
  const prev = learned.get(key) ?? {}
  const stored: ProviderQuirks = providerLevel
    ? { ...prev, ...Object.fromEntries(PROVIDER_LEVEL.filter((k) => fix[k] !== undefined).map((k) => [k, fix[k]])) }
    : { ...prev, ...next, authAll: undefined, baseSuffix: undefined, connection: undefined }
  learned.set(key, stored)
  listener?.(providerId, providerLevel ? '*' : modelId, stored, fix)
  return next
}

/** Rechazos de cuenta: no tiene sentido reintentar ni "arreglar" la petición. */
export function isAccountIssue(text: string): boolean {
  return /credit|billing|balance|insufficient|payment|not available to this account|free models are not|upgrade your|subscription|verify your|account (is|has been) (suspended|disabled)/i.test(text)
}

export function isTransient(status: number, text: string): boolean {
  if (isAccountIssue(text)) return false
  if (status === 429) return true
  if ([500, 502, 503, 504, 520, 522, 524, 529].includes(status)) return true
  return /overloaded|temporarily unavailable|try again|timeout|capacity/i.test(text) && status >= 500
}

export function retryDelayMs(headers: Headers, attempt: number): number {
  const ra = headers.get('retry-after')
  if (ra) {
    const secs = Number(ra)
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 20_000)
    const date = Date.parse(ra)
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 20_000)
  }
  return Math.min(1500 * 2 ** attempt, 10_000)
}

const TOOLS_UNSUPPORTED =
  /(does not support|doesn't support|not support(ed)?|unsupported|not available|not enabled|no endpoints found that support)[^.]{0,40}(tool|function)|(tool|function)s?( calling| call| use|_calls?)?[^.]{0,30}(not supported|unsupported|not available|not enabled|is not allowed)/i

/** Analiza un rechazo 4xx y propone una corrección de la petición, o null. */
export function diagnoseRejection(status: number, text: string, body: Record<string, unknown>, ctx: { baseUrl: string; authAll?: boolean }): QuirkFix | null {
  if (isAccountIssue(text)) return null
  const t = text.toLowerCase()

  if ((status === 401 || status === 403) && !ctx.authAll && !/invalid|incorrect|expired|revoked/.test(t)) return { authAll: true }
  if (status === 404 && !/\/v\d+(beta)?(\/|$)/.test(ctx.baseUrl) && !/model/.test(t)) return { baseSuffix: '/v1' }
  if (![400, 404, 415, 422].includes(status)) return null

  // max_tokens → max_completion_tokens (modelos de razonamiento tipo o1/o3)
  if (body.max_tokens !== undefined && t.includes('max_completion_tokens')) return { maxTokensParam: 'max_completion_tokens' }

  // Parámetro concreto mencionado en el error (excepto "tools", que se trata aparte)
  for (const p of OPTIONAL_PARAMS) {
    if (body[p] !== undefined && t.includes(p)) return { dropParam: p }
  }

  if (body.tools && TOOLS_UNSUPPORTED.test(text)) return { promptTools: true }
  if (body.stream && /stream(ing)?[^.]{0,20}(not supported|unsupported|not available)|does not support stream/i.test(text)) return { noStream: true }

  // Errores de validación tipo pydantic: {"loc": ["body", "campo"], …}
  const loc = text.match(/"loc"\s*:\s*\[\s*"body"\s*,\s*"([a-z_]+)"/i)
  if (loc && body[loc[1]] !== undefined && OPTIONAL_PARAMS.includes(loc[1])) return { dropParam: loc[1] }

  // Rechazo genérico de parámetros: se quita el primer opcional presente.
  if (/unknown|unrecognized|unsupported|not permitted|extra (inputs|fields)|invalid (parameter|argument|request)|additional properties/i.test(text)) {
    const p = OPTIONAL_PARAMS.find((k) => body[k] !== undefined && k !== 'max_tokens' && k !== 'max_completion_tokens')
    if (p) return { dropParam: p }
    if (body.tools && /tool|function/i.test(text)) return { promptTools: true }
  }
  return null
}

/** Une base y ruta respetando query strings (?api-version=…) y endpoints completos. */
export function endpointUrl(base: string, path: string, suffix = ''): string {
  const [rawBase, query] = base.trim().split('?')
  let b = rawBase.replace(/\/+$/, '')
  b = b.replace(/\/(chat\/completions|completions|models)$/, '')
  if (suffix && !b.endsWith(suffix)) b += suffix
  const url = `${b}${path}`
  return query ? `${url}?${query}` : url
}

export function describeFix(fix: QuirkFix): string {
  if (fix.dropParam) return `no acepta «${fix.dropParam}»: se omite`
  if (fix.maxTokensParam) return `usa ${fix.maxTokensParam}`
  if (fix.noStream) return 'no admite streaming: se usan respuestas completas'
  if (fix.promptTools) return 'no admite herramientas nativas: se usan herramientas por prompt'
  if (fix.authAll) return 'se probó otra cabecera de autenticación'
  if (fix.baseSuffix) return `faltaba ${fix.baseSuffix} en la URL`
  if (fix.connection) return `funciona por conexión ${fix.connection === 'relay' ? '«Relay»' : '«Directa»'}`
  return 'ajuste aplicado'
}
