export function uid(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)
  return prefix ? `${prefix}_${s}` : s
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(abortError())
      },
      { once: true },
    )
  })
}

export function abortError(): Error {
  const e = new Error('Operación cancelada')
  e.name = 'AbortError'
  return e
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /aborted|cancelad/i.test(e.message))
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n… [${s.length - max} caracteres truncados]`
}

/** Estimación barata de tokens (≈3.6 caracteres por token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatUsd(n: number | undefined): string {
  if (!n) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(3)}`
}

export function safeJsonParse<T = unknown>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonl|ya?ml|toml|ini|csv|tsv|xml|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|r|lua|swift|dart|vue|svelte|env|gitignore|dockerfile|makefile|ipynb|log|svg)$/i

export function looksTextual(path: string, bytes?: Uint8Array): boolean {
  if (TEXT_EXT.test(path)) return true
  if (!bytes) return !/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|tar|wasm|mp3|mp4|woff2?|ttf|otf)$/i.test(path)
  const sample = bytes.subarray(0, 4096)
  for (const b of sample) if (b === 0) return false
  return true
}

export function imageMediaType(path: string): string | null {
  const m = path.toLowerCase().match(/\.(png|jpe?g|gif|webp)$/)
  if (!m) return null
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1]
  return `image/${ext}`
}
