// Modelos locales en el navegador con WebLLM (WebGPU).
//
// No hace falta cuenta ni clave: los pesos se descargan una vez desde Hugging
// Face (quedan en la caché del navegador) y la inferencia corre en tu GPU.
// Tus mensajes nunca salen del equipo.

import type { MLCEngineInterface } from '@mlc-ai/web-llm'
import { create } from 'zustand'
import { useNetlog } from '../security/netlog'
import type { ChatMessage } from '../types'
import { toOpenAiMessages } from './openai-compat'
import { ThinkSplitter } from './sse'
import { ProviderError, type ModelInfo, type ProviderAdapter, type StreamEvent, type StreamRequest } from './types'

/** Contexto con el que se cargan los modelos (los presets traen 4096, que no basta para un agente). */
export const LOCAL_CONTEXT = 12_288

const m = (id: string, label: string, sizeMB: number, extra: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  label,
  sizeMB,
  contextWindow: LOCAL_CONTEXT,
  maxOutput: 2048,
  toolMode: 'prompt',
  compactTools: true,
  vision: false,
  priceIn: 0,
  priceOut: 0,
  ...extra,
})

export const WEBLLM_MODELS: ModelInfo[] = [
  m('Qwen3-1.7B-q4f16_1-MLC', 'Qwen3 1.7B · local (recomendado)', 2040, { reasoning: true }),
  m('Qwen3-4B-q4f16_1-MLC', 'Qwen3 4B · local', 3430, { reasoning: true }),
  m('Qwen3-8B-q4f16_1-MLC', 'Qwen3 8B · local (GPU potente)', 5700, { reasoning: true }),
  m('Qwen3-0.6B-q4f16_1-MLC', 'Qwen3 0.6B · local (ligero)', 1400, { reasoning: true }),
  m('DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', 'DeepSeek R1 Distill 7B · local', 5110, { reasoning: true }),
  m('Llama-3.2-3B-Instruct-q4f16_1-MLC', 'Llama 3.2 3B · local', 2260),
  m('Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama 3.2 1B · local (ligero)', 880),
  m('Hermes-3-Llama-3.2-3B-q4f16_1-MLC', 'Hermes 3 (Llama 3.2 3B) · local', 2260),
  m('Phi-3.5-mini-instruct-q4f16_1-MLC', 'Phi 3.5 mini · local', 3670),
  m('gemma-2-2b-it-q4f16_1-MLC', 'Gemma 2 2B · local', 1900),
  m('SmolLM2-1.7B-Instruct-q4f16_1-MLC', 'SmolLM2 1.7B · local', 1770),
]

interface WebLlmState {
  loading: boolean
  progress: number
  text: string
  loaded: string | null
  set: (patch: Partial<Omit<WebLlmState, 'set'>>) => void
}

export const useWebLlm = create<WebLlmState>((set) => ({
  loading: false,
  progress: 0,
  text: '',
  loaded: null,
  set: (patch) => set(patch),
}))

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }

let gpuCheck: Promise<boolean> | null = null

/** true si hay una GPU utilizable por WebGPU (no basta con que exista la API). */
export function checkWebGpu(): Promise<boolean> {
  gpuCheck ??= (async () => {
    const gpu = typeof navigator !== 'undefined' ? (navigator as GpuNavigator).gpu : undefined
    if (!gpu) return false
    try {
      return !!(await gpu.requestAdapter())
    } catch {
      return false
    }
  })()
  return gpuCheck
}

export const useWebGpu = create<{ available: boolean | null }>(() => ({ available: null }))
if (typeof navigator !== 'undefined') void checkWebGpu().then((available) => useWebGpu.setState({ available }))


let engine: MLCEngineInterface | null = null
let enginePromise: Promise<MLCEngineInterface> | null = null
let loadedModel: string | null = null
let loading: Promise<void> | null = null

async function getEngine(modelId: string): Promise<MLCEngineInterface> {
  if (!(await checkWebGpu())) {
    throw new ProviderError(
      'Tu navegador no tiene WebGPU, necesario para los modelos locales. Usa Chrome o Edge actualizados en un ordenador (o Safari 26+) y activa la aceleración por hardware.',
    )
  }
  const webllm = await import('@mlc-ai/web-llm')
  const chatOpts = { context_window_size: LOCAL_CONTEXT }
  const progress = (r: { progress: number; text: string }) => useWebLlm.getState().set({ loading: r.progress < 1, progress: r.progress, text: r.text })
  if (!enginePromise) {
    const cached = await webllm.hasModelInCache(modelId).catch(() => false)
    if (!cached) logDownload(modelId)
    useWebLlm.getState().set({ loading: true, progress: 0, text: 'Preparando el modelo local…' })
    enginePromise = webllm.CreateWebWorkerMLCEngine(new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' }), modelId, { initProgressCallback: progress }, chatOpts)
    try {
      engine = await enginePromise
      loadedModel = modelId
    } catch (e) {
      enginePromise = null
      throw toProviderError(e)
    } finally {
      useWebLlm.getState().set({ loading: false, loaded: loadedModel })
    }
  }
  engine = await enginePromise
  if (loadedModel !== modelId) {
    // Un solo modelo cargado a la vez; los cambios se serializan.
    loading = (loading ?? Promise.resolve()).then(async () => {
      if (loadedModel === modelId) return
      const cached = await webllm.hasModelInCache(modelId).catch(() => false)
      if (!cached) logDownload(modelId)
      engine!.setInitProgressCallback(progress)
      useWebLlm.getState().set({ loading: true, progress: 0, text: 'Cambiando de modelo local…' })
      try {
        await engine!.reload(modelId, chatOpts)
        loadedModel = modelId
      } finally {
        useWebLlm.getState().set({ loading: false, loaded: loadedModel })
      }
    })
    try {
      await loading
    } catch (e) {
      throw toProviderError(e)
    }
  }
  return engine
}

function logDownload(modelId: string) {
  const size = WEBLLM_MODELS.find((x) => x.id === modelId)?.sizeMB
  useNetlog.getState().add({
    purpose: 'models',
    label: `Modelo local · descarga de ${modelId}${size ? ` (~${(size / 1024).toFixed(1)} GB)` : ''}`,
    method: 'GET',
    url: `https://huggingface.co/mlc-ai/${modelId}`,
    via: 'direct',
    requestBytes: 0,
    redactions: 0,
    status: 200,
  })
}

function toProviderError(e: unknown): ProviderError {
  const msg = e instanceof Error ? e.message : String(e)
  if (/quota|storage|QuotaExceeded/i.test(msg)) return new ProviderError(`No hay espacio en el navegador para guardar el modelo: ${msg}`)
  if (/device|adapter|webgpu|gpu/i.test(msg)) return new ProviderError(`Error de WebGPU (tu GPU o navegador no puede ejecutar este modelo; prueba uno más pequeño): ${msg}`)
  if (/fetch|network/i.test(msg)) return new ProviderError(`No se pudo descargar el modelo (revisa tu conexión): ${msg}`)
  return new ProviderError(`Modelo local: ${msg}`)
}

type LocalMsg = { role: 'system' | 'user' | 'assistant'; content: string }

/** WebLLM solo acepta system/user/assistant, alternando y terminando en user. */
export function toLocalMessages(system: string, messages: ChatMessage[]): LocalMsg[] {
  const oai = toOpenAiMessages(system, messages, { vision: false, sendReasoningBack: false })
  const out: LocalMsg[] = []
  for (const msg of oai) {
    const role = msg.role === 'tool' ? 'user' : msg.role
    const content = typeof msg.content === 'string' ? msg.content : (msg.content ?? []).map((p) => ('text' in p ? p.text : '')).join('\n')
    const text = content || ' '
    const last = out[out.length - 1]
    if (role === 'system' && out.length > 0) {
      out[0] = { role: 'system', content: `${out[0].content}\n\n${text}` }
    } else if (last && last.role === role) {
      last.content = `${last.content}\n\n${text}`
    } else {
      out.push({ role, content: text } as LocalMsg)
    }
  }
  if (out[1]?.role === 'assistant') out.splice(1, 0, { role: 'user', content: '(continuación)' })
  if (out[out.length - 1]?.role !== 'user') out.push({ role: 'user', content: 'Continúa.' })
  return out
}

export const webLlmAdapter: ProviderAdapter = {
  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const eng = await getEngine(req.model.id)
    if (req.signal.aborted) throw new DOMException('Operación cancelada', 'AbortError')
    const onAbort = () => void eng.interruptGenerate()
    req.signal.addEventListener('abort', onAbort, { once: true })
    const thinking = req.model.reasoning && /qwen3/i.test(req.model.id) ? { extra_body: { enable_thinking: req.params.reasoningEffort !== 'low' } } : {}
    try {
      const chunks = await eng.chat.completions.create({
        messages: toLocalMessages(req.system, req.messages),
        stream: true,
        stream_options: { include_usage: true },
        temperature: req.params.temperature,
        top_p: req.params.topP,
        max_tokens: req.params.maxTokens || req.model.maxOutput || 2048,
        ...thinking,
      })
      const splitter = new ThinkSplitter()
      let finish = ''
      for await (const chunk of chunks) {
        const choice = chunk.choices?.[0]
        const delta = choice?.delta?.content
        if (delta) for (const part of splitter.push(delta)) yield part
        if (choice?.finish_reason) finish = choice.finish_reason
        if (chunk.usage) yield { type: 'usage', usage: { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 } }
      }
      for (const part of splitter.flush()) yield part
      yield { type: 'stop', reason: req.signal.aborted ? 'aborted' : finish || 'stop' }
    } catch (e) {
      if (req.signal.aborted) throw new DOMException('Operación cancelada', 'AbortError')
      throw toProviderError(e)
    } finally {
      req.signal.removeEventListener('abort', onAbort)
    }
  },
  async listModels() {
    return WEBLLM_MODELS
  },
}

/** Descarga y carga un modelo por adelantado. */
export async function preloadLocalModel(modelId: string): Promise<void> {
  await getEngine(modelId)
}

export async function isLocalModelCached(modelId: string): Promise<boolean> {
  const webllm = await import('@mlc-ai/web-llm')
  return webllm.hasModelInCache(modelId).catch(() => false)
}

export async function deleteLocalModel(modelId: string): Promise<void> {
  const webllm = await import('@mlc-ai/web-llm')
  if (loadedModel === modelId && engine) {
    await engine.unload()
    engine = null
    enginePromise = null
    loadedModel = null
    useWebLlm.getState().set({ loaded: null })
  }
  await webllm.deleteModelAllInfoInCache(modelId)
}
