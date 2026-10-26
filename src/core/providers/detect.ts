// Detección automática de un proveedor a partir de su URL (y clave):
// tipo de API, ruta, cabecera de autenticación, conexión y lista de modelos.

import { anthropicAdapter } from './anthropic'
import { quirksFor } from './compat'
import { openAiAdapter } from './openai-compat'
import { PRESETS, providerFromPreset } from './presets'
import type { ProviderConfig } from './types'

export interface DetectResult {
  provider: ProviderConfig
  notes: string[]
}

export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim()
  if (!/^https?:\/\//i.test(url)) url = `${/^(localhost|127\.)/.test(url) ? 'http' : 'https'}://${url}`
  const [base, query] = url.split('?')
  const clean = base.replace(/\/+$/, '').replace(/\/(chat\/completions|completions|models|messages)$/, '')
  return query ? `${clean}?${query}` : clean
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export async function detectProvider(rawUrl: string, apiKey: string, id: string): Promise<DetectResult> {
  const baseUrl = normalizeBaseUrl(rawUrl)
  const host = hostOf(baseUrl)
  if (!host) throw new Error('URL no válida')
  const notes: string[] = []

  // ¿Coincide con un preset conocido? Se reutilizan sus ajustes (notas, cabeceras…).
  const preset = PRESETS.find((p) => p.baseUrl.startsWith('http') && hostOf(p.baseUrl) === host)
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host)
  let provider: ProviderConfig = preset
    ? { ...providerFromPreset(preset, id), baseUrl: preset.kind === 'anthropic' ? preset.baseUrl : baseUrl, models: [] }
    : {
        id,
        name: host.replace(/^api\./, ''),
        kind: /anthropic\.com$/.test(host) || /\/anthropic(\/|$)/.test(baseUrl) ? 'anthropic' : 'openai',
        presetId: 'custom',
        baseUrl,
        connection: 'direct',
        models: [],
        enabled: true,
      }
  if (local) provider.connection = 'direct'
  if (preset) notes.push(`Reconocido como ${preset.name}.`)

  try {
    const models = provider.kind === 'anthropic' ? await anthropicAdapter.listModels(provider, apiKey) : await openAiAdapter.listModels(provider, apiKey, AbortSignal.timeout(25_000))
    const q = quirksFor(id, '__models__')
    provider = {
      ...provider,
      connection: q.connection ?? provider.connection,
      quirks: { authAll: q.authAll, baseSuffix: q.baseSuffix, connection: q.connection },
      models: models.map((m) => ({ toolMode: 'native' as const, ...m })),
    }
    notes.push(`${models.length} modelos encontrados.`)
    if (q.baseSuffix) notes.push(`Se añadió ${q.baseSuffix} a la URL.`)
    if (q.authAll) notes.push('Se usan cabeceras de autenticación alternativas.')
    if (q.connection) notes.push(`Conexión: ${q.connection === 'relay' ? 'por relay (el proveedor no permite CORS)' : 'directa'}.`)
  } catch (e) {
    const q = quirksFor(id, '__models__')
    provider = { ...provider, connection: q.connection ?? provider.connection, quirks: { authAll: q.authAll, baseSuffix: q.baseSuffix, connection: q.connection } }
    const reason = (e as Error).name === 'TimeoutError' ? 'el proveedor no respondió en 25 s' : (e as Error).message.slice(0, 160)
    notes.push(`No se pudo listar los modelos (${reason}). Puedes añadir el id del modelo a mano: el resto se ajusta solo al usarlo.`)
  }
  return { provider, notes }
}
