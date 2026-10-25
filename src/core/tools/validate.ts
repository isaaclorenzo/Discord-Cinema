// Validación ligera de entradas de herramientas contra su JSON Schema
// (subconjunto: type, required, enum, properties, items). Los modelos en los
// que no confiamos a menudo envían argumentos mal formados; esto produce un
// error claro que el modelo puede corregir en lugar de romper la herramienta.

import type { JsonSchema } from '../types'

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v)
  if (t === 'number') return actual === 'number' || actual === 'integer'
  return actual === t
}

export function validateInput(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  const errors: string[] = []
  const type = schema.type as string | string[] | undefined
  if (type) {
    const types = Array.isArray(type) ? type : [type]
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path} must be ${types.join(' or ')}, got ${typeOf(value)}`)
      return errors
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`)
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (obj[key] === undefined) errors.push(`${path}.${key} is required`)
    }
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {}
    for (const [k, sub] of Object.entries(props)) {
      if (obj[k] !== undefined) errors.push(...validateInput(sub, obj[k], `${path}.${k}`))
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validateInput(schema.items as JsonSchema, item, `${path}[${i}]`)))
  }
  return errors
}

/** Corrige errores típicos: números como strings, booleanos como "true". */
export function coerceInput(schema: JsonSchema, value: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {}
  const out: Record<string, unknown> = { ...value }
  for (const [k, sub] of Object.entries(props)) {
    const v = out[k]
    if (typeof v !== 'string') continue
    if ((sub.type === 'number' || sub.type === 'integer') && v.trim() !== '' && !Number.isNaN(Number(v))) out[k] = Number(v)
    else if (sub.type === 'boolean' && (v === 'true' || v === 'false')) out[k] = v === 'true'
    else if ((sub.type === 'array' || sub.type === 'object') && /^[[{]/.test(v.trim())) {
      try {
        out[k] = JSON.parse(v)
      } catch {
        /* se deja tal cual; la validación informará del error */
      }
    }
  }
  return out
}
