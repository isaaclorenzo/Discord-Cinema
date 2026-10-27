// Detecta claves de API usadas con el proveedor equivocado (p. ej. una clave
// de OrcaRouter enviada a Token Harbor). Cada proveedor solo acepta sus propias
// claves; solo se reconocen prefijos distintivos para no dar falsos avisos.

const KEY_ORIGINS: Array<{ prefix: string; provider: string; domain: string }> = [
  { prefix: 'sk-orca-', provider: 'OrcaRouter', domain: 'orcarouter.ai' },
  { prefix: 'thk_', provider: 'Token Harbor', domain: 'tokenharbor.ai' },
  { prefix: 'sk-or-', provider: 'OpenRouter', domain: 'openrouter.ai' },
  { prefix: 'sk-ant-', provider: 'Anthropic', domain: 'anthropic.com' },
  { prefix: 'AIza', provider: 'Google', domain: 'googleapis.com' },
  { prefix: 'gsk_', provider: 'Groq', domain: 'groq.com' },
  { prefix: 'xai-', provider: 'xAI', domain: 'x.ai' },
]

export interface KeyMismatch {
  /** Proveedor al que pertenece la clave según su prefijo. */
  keyProvider: string
  prefix: string
  /** Host al que se está enviando. */
  host: string
}

export function keyMismatch(key: string, baseUrl: string): KeyMismatch | null {
  const origin = KEY_ORIGINS.find((o) => key.trim().startsWith(o.prefix))
  if (!origin) return null
  let host: string
  try {
    host = new URL(baseUrl).hostname
  } catch {
    return null
  }
  // Un proxy propio en local (LiteLLM, etc.) puede reenviar cualquier clave.
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return null
  if (host === origin.domain || host.endsWith(`.${origin.domain}`)) return null
  return { keyProvider: origin.provider, prefix: origin.prefix, host }
}

export function describeKeyMismatch(m: KeyMismatch): string {
  return `Esta clave es de ${m.keyProvider} (empieza por ${m.prefix}), pero la estás enviando a ${m.host}. Cada proveedor solo acepta sus propias claves: crea una en ${m.host} o cambia la URL.`
}
