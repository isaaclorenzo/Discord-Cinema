// Guard de salida: detecta secretos y datos personales en todo lo que sale
// hacia un proveedor o hacia la web, y bloquea, redacta o avisa.

export type GuardAction = 'block' | 'redact' | 'warn' | 'off'

export interface Detector {
  id: string
  label: string
  regex: RegExp
  validate?: (match: string) => boolean
  /** Activo por defecto. */
  defaultOn: boolean
}

export interface GuardConfig {
  action: GuardAction
  /** Activación por detector (si falta, se usa defaultOn). */
  detectors: Record<string, boolean>
  /** Términos propios (nombre, empresa, dirección…), sin distinguir mayúsculas. */
  customTerms: string[]
  /** Valores concretos que se permiten aunque coincidan (p. ej. emails de ejemplo). */
  allowList: string[]
}

export interface Finding {
  detector: string
  label: string
  value: string
  /** Ruta dentro del payload (p. ej. messages[3].content). */
  where: string
}

export const DEFAULT_GUARD: GuardConfig = {
  action: 'block',
  detectors: {},
  customTerms: [],
  allowList: ['user@example.com', 'test@example.com', 'noreply@example.com'],
}

function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  if (/^(\d)\1+$/.test(digits)) return false
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (s.length < 15 || s.length > 34) return false
  const moved = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of code) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

export const DETECTORS: Detector[] = [
  {
    id: 'private-key',
    label: 'Clave privada',
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    defaultOn: true,
  },
  { id: 'openai-key', label: 'Clave de API (sk-…)', regex: /\bsk-(?:proj-|ant-|or-v1-|live-)?[A-Za-z0-9_-]{20,}/g, defaultOn: true },
  { id: 'aws-key', label: 'Clave de AWS', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, defaultOn: true },
  { id: 'github-token', label: 'Token de GitHub', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g, defaultOn: true },
  { id: 'slack-token', label: 'Token de Slack', regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, defaultOn: true },
  { id: 'google-key', label: 'Clave de Google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, defaultOn: true },
  { id: 'stripe-key', label: 'Clave de Stripe', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g, defaultOn: true },
  { id: 'supabase-key', label: 'Clave de Supabase', regex: /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{20,}/g, defaultOn: true },
  { id: 'hf-token', label: 'Token de Hugging Face', regex: /\bhf_[A-Za-z0-9]{30,}\b/g, defaultOn: true },
  {
    id: 'jwt',
    label: 'Token JWT',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    defaultOn: true,
  },
  {
    id: 'secret-assignment',
    label: 'Contraseña o secreto asignado',
    regex: /\b(?:password|passwd|pwd|contraseña|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[^\s"'`]{8,}/gi,
    defaultOn: true,
  },
  {
    id: 'connection-string',
    label: 'Cadena de conexión con credenciales',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi,
    defaultOn: true,
  },
  { id: 'email', label: 'Email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, defaultOn: true },
  {
    id: 'credit-card',
    label: 'Tarjeta de crédito',
    regex: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: luhn,
    defaultOn: true,
  },
  {
    id: 'iban',
    label: 'IBAN',
    regex: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    validate: ibanValid,
    defaultOn: true,
  },
  {
    id: 'phone',
    label: 'Teléfono',
    regex: /(?<![\w+])\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{2,4}\b/g,
    defaultOn: true,
  },
  {
    id: 'private-ip',
    label: 'IP privada',
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    defaultOn: false,
  },
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function activeDetectors(cfg: GuardConfig): Detector[] {
  const list = DETECTORS.filter((d) => cfg.detectors[d.id] ?? d.defaultOn)
  const terms = cfg.customTerms.map((t) => t.trim()).filter((t) => t.length >= 2)
  if (terms.length) {
    list.push({
      id: 'custom',
      label: 'Término propio',
      regex: new RegExp(terms.map(escapeRegex).join('|'), 'gi'),
      defaultOn: true,
    })
  }
  return list
}

export function scanText(text: string, cfg: GuardConfig, where = 'texto'): Finding[] {
  if (cfg.action === 'off' || !text) return []
  const allow = new Set(cfg.allowList.map((a) => a.toLowerCase()))
  const out: Finding[] = []
  for (const d of activeDetectors(cfg)) {
    d.regex.lastIndex = 0
    for (const m of text.matchAll(d.regex)) {
      const value = m[0]
      if (allow.has(value.toLowerCase())) continue
      if (d.validate && !d.validate(value)) continue
      out.push({ detector: d.id, label: d.label, value, where })
    }
  }
  return out
}

export function redactText(text: string, cfg: GuardConfig, where = 'texto'): { text: string; findings: Finding[] } {
  const findings = scanText(text, cfg, where)
  if (!findings.length) return { text, findings }
  let result = text
  // Primero los valores más largos para no romper coincidencias solapadas.
  const sorted = [...findings].sort((a, b) => b.value.length - a.value.length)
  for (const f of sorted) result = result.split(f.value).join(`[REDACTED:${f.detector}]`)
  return { text: result, findings }
}

const BASE64_BLOB = /^[A-Za-z0-9+/=\s]{2000,}$/

/** Recorre un payload JSON y analiza (o redacta) cada string. */
export function guardPayload<T>(payload: T, cfg: GuardConfig, mode: 'scan' | 'redact'): { payload: T; findings: Finding[] } {
  const findings: Finding[] = []
  const visit = (value: unknown, where: string): unknown => {
    if (typeof value === 'string') {
      if (value.startsWith('data:') || BASE64_BLOB.test(value)) return value
      if (mode === 'redact') {
        const r = redactText(value, cfg, where)
        findings.push(...r.findings)
        return r.text
      }
      findings.push(...scanText(value, cfg, where))
      return value
    }
    if (Array.isArray(value)) return value.map((v, i) => visit(v, `${where}[${i}]`))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        // Firmas y datos binarios de imágenes no se analizan.
        if (k === 'signature' || (k === 'data' && typeof v === 'string' && v.length > 1000)) out[k] = v
        else out[k] = visit(v, where ? `${where}.${k}` : k)
      }
      return out
    }
    return value
  }
  const result = visit(payload, '') as T
  return { payload: result, findings }
}

export class GuardBlockedError extends Error {
  findings: Finding[]
  target: string
  constructor(findings: Finding[], target: string) {
    const kinds = [...new Set(findings.map((f) => f.label))].join(', ')
    super(`El escudo de privacidad bloqueó el envío a ${target}: se detectó ${kinds}.`)
    this.name = 'GuardBlockedError'
    this.findings = findings
    this.target = target
  }
}

export function maskValue(v: string): string {
  if (v.length <= 8) return '•'.repeat(v.length)
  return `${v.slice(0, 4)}${'•'.repeat(Math.min(v.length - 6, 16))}${v.slice(-2)}`
}
