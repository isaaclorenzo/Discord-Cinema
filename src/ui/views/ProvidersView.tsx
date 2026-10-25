import { Check, ChevronDown, Download, ExternalLink, KeyRound, Plus, Server, Trash2, TriangleAlert, Zap } from 'lucide-react'
import { useState } from 'react'
import { getAdapter } from '../../core/providers'
import { PRESETS } from '../../core/providers/presets'
import type { ModelInfo, ProviderConfig } from '../../core/providers/types'
import { uid } from '../../core/util'
import { useSecrets } from '../../state/secrets'
import { useSettings } from '../../state/settings'
import { useRelay } from '../../state/relay'
import { deleteLocalModel, isLocalModelCached, preloadLocalModel, useWebGpu, useWebLlm } from '../../core/providers/webllm'
import { useEffect } from 'react'
import { useUi } from '../../state/ui'
import { cx } from '../cx'
import { Field, Modal, PageHeader, PageShell, Spinner, Toggle } from '../primitives'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^api\./, '')
  } catch {
    return ''
  }
}

function GpuNote() {
  const gpu = useWebGpu((s) => s.available)
  if (gpu === null) return null
  return (
    <p className={cx('mt-3 text-xs', gpu ? 'text-ok' : 'text-amber')}>
      {gpu
        ? 'WebGPU disponible en este navegador. Descarga un modelo por adelantado o elígelo en el chat y se descargará solo.'
        : 'Este navegador o equipo no tiene WebGPU disponible: los modelos locales necesitan Chrome o Edge actualizados en un ordenador con GPU (o Safari 26+).'}
    </p>
  )
}

function LocalModelActions({ id, sizeMB }: { id: string; sizeMB?: number }) {
  const [cached, setCached] = useState<boolean | null>(null)
  const loading = useWebLlm((s) => s.loading)
  const loaded = useWebLlm((s) => s.loaded)
  const gpu = useWebGpu((s) => s.available)
  useEffect(() => {
    let alive = true
    if (gpu) void isLocalModelCached(id).then((c) => alive && setCached(c))
    return () => {
      alive = false
    }
  }, [id, loaded, gpu])
  if (!gpu) return sizeMB ? <span className="chip">{(sizeMB / 1024).toFixed(1)} GB</span> : null
  return (
    <>
      {sizeMB ? <span className="chip">{(sizeMB / 1024).toFixed(1)} GB</span> : null}
      {cached ? (
        <button
          className="btn px-2 py-1 text-xs"
          title="Borrar el modelo de la caché del navegador"
          onClick={async () => {
            await deleteLocalModel(id)
            setCached(false)
            useUi.getState().toast('Modelo borrado de la caché', 'success')
          }}
        >
          <Trash2 size={12} /> Borrar
        </button>
      ) : (
        <button
          className="btn px-2 py-1 text-xs"
          disabled={loading}
          onClick={async () => {
            try {
              await preloadLocalModel(id)
              setCached(true)
              useUi.getState().toast('Modelo listo para usar', 'success')
            } catch (e) {
              useUi.getState().toast((e as Error).message, 'error')
            }
          }}
        >
          <Download size={12} /> Descargar
        </button>
      )}
    </>
  )
}

function ModelRow({ provider, model }: { provider: ProviderConfig; model: ModelInfo }) {
  const [open, setOpen] = useState(false)
  const update = (patch: Partial<ModelInfo>) =>
    useSettings.getState().updateProvider(provider.id, { models: provider.models.map((m) => (m.id === model.id ? { ...m, ...patch } : m)) })
  const remove = () => useSettings.getState().updateProvider(provider.id, { models: provider.models.filter((m) => m.id !== model.id) })
  const selected = useSettings((s) => s.selected) === `${provider.id}::${model.id}`
  return (
    <div className="glass-inset rounded-xl">
      <div className="flex items-center gap-2 px-3 py-2">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)}>
          <ChevronDown size={13} className={cx('shrink-0 text-faint transition', !open && '-rotate-90')} />
          <span className="truncate font-mono text-[12.5px]">{model.id}</span>
          {model.label && <span className="hidden truncate text-xs text-muted sm:inline">{model.label}</span>}
        </button>
        {model.toolMode === 'prompt' && <span className="chip">tools por prompt</span>}
        {model.toolMode === 'none' && <span className="chip">sin tools</span>}
        {model.vision && <span className="chip">visión</span>}
        {provider.kind === 'webllm' && <LocalModelActions id={model.id} sizeMB={model.sizeMB} />}
        <button
          className={cx('btn px-2 py-1 text-xs', selected && 'border-violet-300/40 text-violet-100')}
          onClick={() => {
            useSettings.getState().set({ selected: `${provider.id}::${model.id}` })
            useUi.getState().toast(`Modelo por defecto: ${model.id}`, 'success')
          }}
        >
          {selected ? <Check size={12} /> : null} {selected ? 'Por defecto' : 'Usar'}
        </button>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-white/[0.06] p-3 sm:grid-cols-2">
          <Field label="Nombre visible">
            <input className="input" value={model.label ?? ''} onChange={(e) => update({ label: e.target.value || undefined })} />
          </Field>
          <Field label="Herramientas" hint="Usa «por prompt» si el modelo no soporta function calling.">
            <select className="input" value={model.toolMode ?? 'native'} onChange={(e) => update({ toolMode: e.target.value as ModelInfo['toolMode'] })}>
              <option value="native">Nativas (function calling)</option>
              <option value="prompt">Por prompt (XML)</option>
              <option value="none">Sin herramientas</option>
            </select>
          </Field>
          <Field label="Ventana de contexto (tokens)" hint="Para la autocompactación y /context.">
            <input className="input" type="number" value={model.contextWindow ?? ''} onChange={(e) => update({ contextWindow: Number(e.target.value) || undefined })} />
          </Field>
          <Field label="Máx. tokens de salida">
            <input className="input" type="number" value={model.maxOutput ?? ''} onChange={(e) => update({ maxOutput: Number(e.target.value) || undefined })} />
          </Field>
          <Field label="Precio entrada ($ / M tokens)">
            <input className="input" type="number" step="0.01" value={model.priceIn ?? ''} onChange={(e) => update({ priceIn: Number(e.target.value) || undefined })} />
          </Field>
          <Field label="Precio salida ($ / M tokens)">
            <input className="input" type="number" step="0.01" value={model.priceOut ?? ''} onChange={(e) => update({ priceOut: Number(e.target.value) || undefined })} />
          </Field>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <Toggle checked={!!model.vision} onChange={(v) => update({ vision: v })} label="Visión (imágenes)" />
            <Toggle checked={!!model.reasoning} onChange={(v) => update({ reasoning: v })} label="Razonamiento" />
            <button className="btn btn-danger ml-auto px-2 py-1 text-xs" onClick={remove}>
              <Trash2 size={12} /> Quitar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProviderCard({ p }: { p: ProviderConfig }) {
  const key = useSecrets((s) => s.keys[p.id] ?? '')
  const vault = useSecrets((s) => s.unlocked)
  const preset = PRESETS.find((x) => x.id === p.presetId)
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [newModel, setNewModel] = useState('')
  const update = (patch: Partial<ProviderConfig>) => useSettings.getState().updateProvider(p.id, patch)
  const isMock = p.kind === 'mock' || p.kind === 'webllm'

  const loadModels = async () => {
    setLoading(true)
    try {
      const models = await getAdapter(p).listModels(p, key)
      useSettings.getState().setModels(p.id, models)
      useUi.getState().toast(`${models.length} modelos cargados de ${p.name}`, 'success')
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const test = async () => {
    const model = p.models[0]
    if (!model) return useUi.getState().toast('Añade o carga al menos un modelo', 'error')
    setTesting(true)
    try {
      let out = ''
      for await (const ev of getAdapter(p, { ...model, toolMode: 'none' }).stream({
        provider: p,
        apiKey: key,
        model,
        system: 'Reply with exactly: OK',
        messages: [{ id: uid('m'), role: 'user', content: 'ping', createdAt: Date.now() }],
        tools: [],
        params: { maxTokens: 512 },
        signal: AbortSignal.timeout(60_000),
        label: `${p.name} · prueba`,
      })) {
        if (ev.type === 'text') out += ev.text
      }
      useUi.getState().toast(`${p.name} respondió: ${out.trim().slice(0, 80) || '(vacío)'}`, 'success')
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className={cx('glass rounded-[var(--radius-glass)] p-5', !p.enabled && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="glass-inset grid size-10 shrink-0 place-items-center rounded-2xl text-violet-200">
          <Server size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <input className="w-full bg-transparent text-base font-semibold focus:outline-none" value={p.name} onChange={(e) => update({ name: e.target.value })} aria-label="Nombre del proveedor" />
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="chip">{p.kind === 'anthropic' ? 'API de Anthropic' : p.kind === 'mock' ? 'Simulado' : 'Compatible con OpenAI'}</span>
            {preset?.keyUrl && (
              <a className="inline-flex items-center gap-1 hover:text-fg" href={preset.keyUrl} target="_blank" rel="noopener noreferrer">
                Obtener clave <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
        <Toggle checked={p.enabled} onChange={(v) => update({ enabled: v })} label="Activo" />
        {p.id !== 'demo' && (
          <button
            className="btn btn-ghost btn-icon hover:text-rose-200"
            aria-label={`Eliminar ${p.name}`}
            onClick={() => {
              if (confirm(`¿Eliminar ${p.name}?`)) {
                useSettings.getState().removeProvider(p.id)
                useSecrets.getState().setKey(p.id, '')
              }
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {p.note && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs text-amber-100/80">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" /> {p.note}
        </p>
      )}
      {!isMock && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="URL base">
            <input className="input font-mono text-xs" value={p.baseUrl} onChange={(e) => {
                const baseUrl = e.target.value.trim()
                const patch: Partial<ProviderConfig> = { baseUrl }
                // Un proveedor personalizado toma el nombre de su dominio mientras no lo renombres.
                if (p.presetId === 'custom' && (p.name === preset?.name || p.name === hostOf(p.baseUrl))) {
                  const host = hostOf(baseUrl)
                  if (host) patch.name = host
                }
                update(patch)
              }} spellCheck={false} />
          </Field>
          <Field label="Clave de API" hint={vault ? 'Se guarda cifrada en tu bóveda.' : 'Solo en memoria: se borra al cerrar la pestaña. Activa la bóveda en Seguridad para recordarla cifrada.'}>
            <div className="relative">
              <KeyRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className="input pl-8 font-mono text-xs" type="password" autoComplete="off" value={key} placeholder={/localhost|127\.0\.0\.1/.test(p.baseUrl) ? 'No suele hacer falta en local' : 'sk-…'} onChange={(e) => useSecrets.getState().setKey(p.id, e.target.value.trim())} />
            </div>
          </Field>
          <Field label="Conexión" hint="«Relay» pasa por tu propio servidor (/api/relay) para evitar bloqueos CORS. «Directa» va del navegador al proveedor.">
            <select className="input" value={p.connection} onChange={(e) => update({ connection: e.target.value as ProviderConfig['connection'] })}>
              <option value="relay">Relay propio</option>
              <option value="direct">Directa</option>
            </select>
          </Field>
          <div className="flex flex-col justify-end gap-2">
            {p.kind === 'openai' && (
              <Toggle checked={!!p.sendReasoningBack} onChange={(v) => update({ sendReasoningBack: v })} label="Reenviar reasoning_content" hint="Necesario en DeepSeek y Kimi con herramientas en modo razonamiento." />
            )}
            {p.kind === 'anthropic' && (
              <Toggle checked={p.refusalFallback !== false} onChange={(v) => update({ refusalFallback: v })} label="Fallback ante rechazos" hint="Si el modelo rechaza, otro modelo de Claude continúa. Se indica «servido por»." />
            )}
          </div>
        </div>
      )}
      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Modelos ({p.models.length})</h3>
          <div className="ml-auto flex flex-wrap gap-2">
            {!isMock && (
              <button className="btn px-2.5 py-1 text-xs" onClick={loadModels} disabled={loading}>
                {loading ? <Spinner size={12} /> : <Download size={12} />} Cargar modelos
              </button>
            )}
            <button className="btn px-2.5 py-1 text-xs" onClick={test} disabled={testing}>
              {testing ? <Spinner size={12} /> : <Zap size={12} />} Probar
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {p.models.map((m) => (
            <ModelRow key={m.id} provider={p} model={m} />
          ))}
        </div>
        {p.kind === 'webllm' && <GpuNote />}
        {!isMock && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const id = newModel.trim()
              if (!id || p.models.some((m) => m.id === id)) return
              update({ models: [...p.models, { id, toolMode: 'native' }] })
              setNewModel('')
            }}
          >
            <input className="input py-1.5 font-mono text-xs" placeholder="Añadir modelo por id (p. ej. deepseek-chat)" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
            <button className="btn px-2.5 text-xs" type="submit">
              <Plus size={12} /> Añadir
            </button>
          </form>
        )}
      </div>
    </section>
  )
}

function RelayBanner() {
  const status = useRelay((s) => s.status)
  if (status === 'ok' || status === 'checking') return null
  const text =
    status === 'missing'
      ? 'Este despliegue no tiene relay (por ejemplo, GitHub Pages). Usa conexión «Directa» con proveedores que la permiten (OpenRouter, Anthropic, Ollama o LM Studio en local) o configura un relay externo en Seguridad. WebFetch, WebSearch y MCP también lo necesitan.'
      : status === 'needs-token'
        ? 'El relay necesita el token de acceso: escríbelo en Seguridad → Relay propio.'
        : 'El relay está desactivado en el servidor: define HARNESS_ACCESS_TOKEN en las variables de entorno del despliegue.'
  return (
    <p className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-100/85">
      <TriangleAlert size={14} className="mt-0.5 shrink-0" />
      <span>
        {text}{' '}
        <button className="underline underline-offset-2" onClick={() => useUi.getState().setView('security')}>
          Abrir Seguridad
        </button>
      </span>
    </p>
  )
}

export function ProvidersView() {
  const providers = useSettings((s) => s.providers)
  const [adding, setAdding] = useState(false)
  return (
    <PageShell>
      <PageHeader
        icon={<Server size={18} />}
        title="Proveedores"
        subtitle="Conecta los modelos que quieres poner a prueba. Las claves nunca se envían a otro sitio que no sea su proveedor."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Añadir proveedor
          </button>
        }
      />
      <RelayBanner />
      <div className="space-y-4">
        {providers.map((p) => (
          <ProviderCard key={p.id} p={p} />
        ))}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Añadir proveedor" wide>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.filter((p) => p.id !== 'demo').map((p) => (
            <button
              key={p.id}
              className="glass-inset rounded-2xl p-3 text-left transition hover:bg-white/[0.06]"
              onClick={() => {
                useSettings.getState().addProvider(p.id)
                setAdding(false)
              }}
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{p.baseUrl}</div>
              {p.note && <div className="mt-1 line-clamp-2 text-[11px] text-amber-100/70">{p.note}</div>}
            </button>
          ))}
        </div>
      </Modal>
    </PageShell>
  )
}
