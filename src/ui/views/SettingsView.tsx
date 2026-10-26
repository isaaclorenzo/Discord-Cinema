import { Download, Plus, Settings, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { downloadText } from '../../app/export'
import { MODE_LABELS } from '../../core/agent/permissions'
import { dbGet, dbKeys, dbSet } from '../../core/storage/db'
import { BUILTIN_TOOL_NAMES } from '../../core/tools/registry'
import type { PermissionMode } from '../../core/types'
import { useSecrets } from '../../state/secrets'
import { useSettings, type SearchBackend } from '../../state/settings'
import { useUi } from '../../state/ui'
import { ModelPicker } from '../chat/Pickers'
import { Field, PageHeader, PageShell, Section, Toggle } from '../primitives'

function RuleList({ kind }: { kind: 'allow' | 'deny' }) {
  const rules = useSettings((s) => s.rules[kind])
  const [draft, setDraft] = useState('')
  return (
    <div>
      <div className="label">{kind === 'allow' ? 'Permitir sin preguntar' : 'Denegar siempre'}</div>
      <div className="flex flex-wrap gap-1.5">
        {rules.map((r) => (
          <span key={r} className="chip font-mono">
            {r}
            <button onClick={() => useSettings.getState().removeRule(kind, r)} aria-label={`Quitar ${r}`} className="hover:text-fg">
              <X size={11} />
            </button>
          </span>
        ))}
        {rules.length === 0 && <span className="text-xs text-faint">Ninguna</span>}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) useSettings.getState().addRule(kind, draft.trim())
          setDraft('')
        }}
      >
        <input className="input py-1.5 font-mono text-xs" placeholder={kind === 'allow' ? 'p. ej. WebFetch(domain:docs.python.org)' : 'p. ej. Bash(rm:*)'} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn px-2.5 text-xs" type="submit">
          <Plus size={12} />
        </button>
      </form>
    </div>
  )
}

export function SettingsView() {
  const s = useSettings()
  const searchKey = useSecrets((x) => x.keys.search ?? '')
  const importRef = useRef<HTMLInputElement>(null)

  const exportAll = async () => {
    const keys = (await dbKeys()).filter((k) => k !== 'gh-vault')
    const data: Record<string, unknown> = {}
    for (const k of keys) {
      const v = await dbGet(k)
      // Las instantáneas del workspace contienen binarios: se exportan como base64 vía JSON.
      data[k] = v
    }
    downloadText(`isc-agent-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'isc-agent-backup', version: 1, data }, (_k, v) => (v instanceof Uint8Array ? { __u8: Array.from(v) } : v)), 'application/json')
  }

  const importAll = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text(), (_k, v) => (v && typeof v === 'object' && Array.isArray(v.__u8) ? new Uint8Array(v.__u8) : v)) as { format?: string; data?: Record<string, unknown> }
      if ((parsed.format !== 'isc-agent-backup' && parsed.format !== 'glasshouse-backup') || !parsed.data) throw new Error('No es una copia de ISC AGENT')
      for (const [k, v] of Object.entries(parsed.data)) await dbSet(k, v)
      useUi.getState().toast('Copia importada. Recargando…', 'success')
      setTimeout(() => location.reload(), 800)
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error')
    }
  }

  return (
    <PageShell>
      <PageHeader icon={<Settings size={18} />} title="Ajustes" subtitle="Comportamiento del agente, permisos, herramientas y datos." />
      <div className="space-y-4">
        <Section title="Perfil" description="Solo se usa en la interfaz (saludo y avatar). Se guarda en este navegador y nunca se envía a ningún modelo.">
          <Field label="Tu nombre (opcional)">
            <input className="input max-w-sm" value={s.userName} maxLength={40} placeholder="Por ejemplo: Isaac" onChange={(e) => s.set({ userName: e.target.value })} />
          </Field>
        </Section>
        <Section title="Modelo y generación" description="Valores por defecto para todas las conversaciones. Cada conversación puede cambiar de modelo desde el compositor.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Modelo por defecto">
              <ModelPicker value={s.selected} onChange={(ref) => s.set({ selected: ref })} up={false} />
            </Field>
            <Field label="Esfuerzo de razonamiento" hint="Se envía como reasoning_effort (OpenAI-compatible) u output_config.effort (Anthropic). Vacío = el del proveedor.">
              <select className="input" value={s.params.reasoningEffort ?? ''} onChange={(e) => s.setParams({ reasoningEffort: e.target.value as never })}>
                <option value="">Por defecto</option>
                <option value="low">Bajo</option>
                <option value="medium">Medio</option>
                <option value="high">Alto</option>
                <option value="xhigh">Muy alto</option>
                <option value="max">Máximo</option>
              </select>
            </Field>
            <Field label={`Temperatura${s.params.temperature === undefined ? ' (por defecto)' : `: ${s.params.temperature}`}`} hint="Solo proveedores compatibles con OpenAI (la API de Anthropic ya no la admite).">
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={2} step={0.05} className="w-full accent-sky-400" value={s.params.temperature ?? 1} onChange={(e) => s.setParams({ temperature: Number(e.target.value) })} />
                <button className="btn px-2 py-1 text-xs" onClick={() => s.setParams({ temperature: undefined })}>
                  Auto
                </button>
              </div>
            </Field>
            <Field label={`Top P${s.params.topP === undefined ? ' (por defecto)' : `: ${s.params.topP}`}`}>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={1} step={0.01} className="w-full accent-sky-400" value={s.params.topP ?? 1} onChange={(e) => s.setParams({ topP: Number(e.target.value) })} />
                <button className="btn px-2 py-1 text-xs" onClick={() => s.setParams({ topP: undefined })}>
                  Auto
                </button>
              </div>
            </Field>
            <Field label="Máx. tokens por respuesta" hint="Vacío = el máximo del modelo o del proveedor.">
              <input className="input" type="number" value={s.params.maxTokens ?? ''} onChange={(e) => s.setParams({ maxTokens: Number(e.target.value) || undefined })} />
            </Field>
            <Field label="Máx. turnos del agente por mensaje">
              <input className="input" type="number" min={1} max={200} value={s.maxTurns} onChange={(e) => s.set({ maxTurns: Math.max(1, Number(e.target.value) || 1) })} />
            </Field>
            <Field label="Modelo auxiliar" hint="Para resumir páginas de WebFetch. Vacío = el mismo de la conversación.">
              <div className="flex gap-2">
                <ModelPicker value={s.helperModel} onChange={(ref) => s.set({ helperModel: ref })} up={false} />
                {s.helperModel && (
                  <button className="btn px-2 text-xs" onClick={() => s.set({ helperModel: '' })}>
                    Quitar
                  </button>
                )}
              </div>
            </Field>
            <div className="space-y-3">
              <Toggle checked={s.autoCompact} onChange={(v) => s.set({ autoCompact: v })} label="Autocompactar" hint={`Resume la conversación al llegar al ${Math.round(s.compactThreshold * 100)}% del contexto del modelo.`} />
            </div>
          </div>
          <div className="mt-4">
            <Field label="Instrucciones propias (se añaden al system prompt)">
              <textarea className="input min-h-24 font-mono text-xs" value={s.customPrompt} onChange={(e) => s.set({ customPrompt: e.target.value })} placeholder="p. ej. Responde siempre en español y explica los pasos." />
            </Field>
          </div>
        </Section>

        <Section title="Permisos" description="Misma sintaxis que Claude Code: Herramienta, Herramienta(prefijo:*), WebFetch(domain:x.com), Edit(/workspace/docs/**), mcp__servidor.">
          <div className="mb-4 max-w-sm">
            <Field label="Modo por defecto">
              <select className="input" value={s.mode} onChange={(e) => s.set({ mode: e.target.value as PermissionMode })}>
                {(Object.keys(MODE_LABELS) as PermissionMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m].label} — {MODE_LABELS[m].hint}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <RuleList kind="allow" />
            <RuleList kind="deny" />
          </div>
        </Section>

        <Section title="Herramientas" description="Desactiva las que no quieras ofrecer al modelo.">
          <div className="grid gap-2 sm:grid-cols-3">
            {BUILTIN_TOOL_NAMES.map((t) => (
              <Toggle
                key={t}
                checked={!s.disabledTools.includes(t)}
                onChange={(on) => s.set({ disabledTools: on ? s.disabledTools.filter((x) => x !== t) : [...s.disabledTools, t] })}
                label={<span className="font-mono text-xs">{t}</span>}
              />
            ))}
          </div>
        </Section>

        <Section title="Búsqueda web" description="Backend de WebSearch. Todas las búsquedas pasan por el escudo y aparecen en el inspector de red.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Proveedor de búsqueda">
              <select className="input" value={s.search.backend} onChange={(e) => s.set({ search: { ...s.search, backend: e.target.value as SearchBackend } })}>
                <option value="duckduckgo">DuckDuckGo (sin clave)</option>
                <option value="brave">Brave Search</option>
                <option value="tavily">Tavily</option>
                <option value="exa">Exa</option>
                <option value="searxng">SearXNG (propio)</option>
              </select>
            </Field>
            {s.search.backend === 'searxng' ? (
              <Field label="URL de SearXNG">
                <input className="input font-mono text-xs" value={s.search.searxngUrl} onChange={(e) => s.set({ search: { ...s.search, searxngUrl: e.target.value.trim() } })} placeholder="https://searx.mi-dominio.com" />
              </Field>
            ) : s.search.backend !== 'duckduckgo' ? (
              <Field label="Clave de API de búsqueda">
                <input className="input font-mono text-xs" type="password" value={searchKey} onChange={(e) => useSecrets.getState().setKey('search', e.target.value.trim())} />
              </Field>
            ) : null}
          </div>
        </Section>

        <Section title="Sandbox" description="Lo que el código del modelo puede hacer dentro del navegador.">
          <div className="space-y-3">
            <Toggle
              checked={s.allowPythonPackages}
              onChange={(v) => s.set({ allowPythonPackages: v })}
              label="Permitir paquetes de Python (numpy, pandas, matplotlib…)"
              hint="Se descargan del CDN oficial de Pyodide (jsDelivr) al importarlos. El código sigue sin poder usar la red para otra cosa."
            />
            <Toggle
              checked={s.previewCdn}
              onChange={(v) => s.set({ previewCdn: v })}
              label="Permitir CDNs en la vista previa"
              hint="Deja que las páginas de Preview carguen scripts y estilos de jsDelivr, cdnjs, unpkg y Tailwind. Las peticiones de datos (fetch) siguen bloqueadas."
            />
          </div>
        </Section>

        <Section title="Datos locales" description="Todo vive en el IndexedDB de este navegador. La copia no incluye la bóveda de claves.">
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={exportAll}>
              <Download size={14} /> Exportar copia
            </button>
            <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
            <button className="btn" onClick={() => importRef.current?.click()}>
              <Upload size={14} /> Importar copia
            </button>
            <button className="btn btn-danger" onClick={() => useUi.getState().setView('security')}>
              <Trash2 size={14} /> Borrar todo (en Seguridad)
            </button>
          </div>
        </Section>
      </div>
    </PageShell>
  )
}
