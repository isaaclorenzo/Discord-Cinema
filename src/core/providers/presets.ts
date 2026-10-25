// Presets de proveedores. Las listas de modelos son un punto de partida: usa
// "Cargar modelos" para traer la lista real desde /models del proveedor.

import { MOCK_MODELS } from './mock'
import { WEBLLM_MODELS } from './webllm'
import type { ModelInfo, ProviderConfig, ProviderKind } from './types'

export interface ProviderPreset {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  connection: 'direct' | 'relay'
  models: ModelInfo[]
  keyUrl?: string
  note?: string
  sendReasoningBack?: boolean
  headers?: Record<string, string>
}

const CN_NOTE = 'Empresa con sede en China. Trata todo lo que envíes como público.'
const m = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, toolMode: 'native', ...extra })

export const PRESETS: ProviderPreset[] = [
  {
    id: 'demo',
    name: 'Demo (sin red)',
    kind: 'mock',
    baseUrl: 'local://demo',
    connection: 'direct',
    models: MOCK_MODELS,
    note: 'Modelo simulado que nunca sale del navegador. Úsalo para conocer la harness.',
  },
  {
    id: 'webllm',
    name: 'Modelos locales (en tu navegador)',
    kind: 'webllm',
    baseUrl: 'local://webllm',
    connection: 'direct',
    models: WEBLLM_MODELS,
    note: 'Gratis y sin cuentas: el modelo se descarga una vez y corre en tu GPU con WebGPU. Tus mensajes no salen del equipo. Son modelos pequeños: más lentos y menos capaces que los de la nube.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    connection: 'relay',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: CN_NOTE,
    sendReasoningBack: true,
    models: [m('deepseek-chat', { contextWindow: 128_000 }), m('deepseek-reasoner', { contextWindow: 128_000, reasoning: true })],
  },
  {
    id: 'qwen',
    name: 'Qwen (Alibaba DashScope)',
    kind: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    connection: 'relay',
    keyUrl: 'https://modelstudio.console.alibabacloud.com/',
    note: CN_NOTE,
    models: [m('qwen-max'), m('qwen-plus'), m('qwen-turbo')],
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    connection: 'relay',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    note: CN_NOTE,
    sendReasoningBack: true,
    models: [],
  },
  {
    id: 'zhipu',
    name: 'GLM (Z.ai / Zhipu)',
    kind: 'openai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    connection: 'relay',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    note: CN_NOTE,
    models: [],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    kind: 'openai',
    baseUrl: 'https://api.minimax.io/v1',
    connection: 'relay',
    keyUrl: 'https://www.minimax.io/platform',
    note: CN_NOTE,
    models: [],
  },
  { id: 'xai', name: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', connection: 'relay', keyUrl: 'https://console.x.ai', models: [] },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    connection: 'relay',
    keyUrl: 'https://console.mistral.ai/api-keys',
    models: [m('mistral-large-latest'), m('mistral-medium-latest'), m('codestral-latest')],
  },
  { id: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', connection: 'relay', keyUrl: 'https://console.groq.com/keys', models: [] },
  { id: 'together', name: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', connection: 'relay', keyUrl: 'https://api.together.ai/settings/api-keys', models: [] },
  { id: 'fireworks', name: 'Fireworks', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', connection: 'relay', keyUrl: 'https://fireworks.ai/account/api-keys', models: [] },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    connection: 'direct',
    keyUrl: 'https://openrouter.ai/settings/keys',
    note: 'Da acceso a casi todos los proveedores con una sola clave. Admite llamadas directas desde el navegador.',
    headers: { 'X-Title': 'Glasshouse' },
    models: [],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    connection: 'relay',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [],
  },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', connection: 'relay', keyUrl: 'https://platform.openai.com/api-keys', models: [] },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    connection: 'direct',
    keyUrl: 'https://platform.claude.com/settings/keys',
    note: 'Referencia para comparar. El fallback ante rechazos está activado en los modelos que lo admiten.',
    models: [
      m('claude-opus-5-5', { label: 'Claude Opus 5.5', contextWindow: 1_000_000, maxOutput: 128_000, vision: true, reasoning: true, priceIn: 4, priceOut: 20 }),
      m('claude-sonnet-5-5', { label: 'Claude Sonnet 5.5', contextWindow: 1_000_000, maxOutput: 128_000, vision: true, reasoning: true, priceIn: 2, priceOut: 10 }),
      m('claude-haiku-5-5', { label: 'Claude Haiku 5.5', contextWindow: 1_000_000, maxOutput: 128_000, vision: true, reasoning: true, priceIn: 0.1, priceOut: 0.5 }),
      m('claude-fable-5-1', { label: 'Claude Fable 5.1', contextWindow: 1_000_000, maxOutput: 128_000, vision: true, reasoning: true, priceIn: 10, priceOut: 50 }),
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    connection: 'direct',
    note: 'Modelos en tu propio equipo. Arranca Ollama con OLLAMA_ORIGINS para permitir el navegador.',
    models: [],
  },
  { id: 'lmstudio', name: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', connection: 'direct', note: 'Activa CORS en el servidor local de LM Studio.', models: [] },
  { id: 'custom', name: 'Personalizado (compatible con OpenAI)', kind: 'openai', baseUrl: 'https://', connection: 'relay', models: [] },
]

export function providerFromPreset(p: ProviderPreset, id: string): ProviderConfig {
  return {
    id,
    name: p.name,
    kind: p.kind,
    presetId: p.id,
    baseUrl: p.baseUrl,
    connection: p.connection,
    headers: p.headers,
    models: p.models.map((x) => ({ ...x })),
    enabled: true,
    sendReasoningBack: p.sendReasoningBack,
    refusalFallback: p.kind === 'anthropic' ? true : undefined,
    note: p.note,
  }
}
