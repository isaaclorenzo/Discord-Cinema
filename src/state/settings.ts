import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_RULES } from '../core/agent/permissions'
import { PRESETS, providerFromPreset } from '../core/providers/presets'
import type { GenParams, ModelInfo, ProviderConfig } from '../core/providers/types'
import { DEFAULT_GUARD, type GuardConfig } from '../core/security/guard'
import { idbStorage } from '../core/storage/db'
import type { PermissionMode, PermissionRules } from '../core/types'
import { uid } from '../core/util'
import { relayState } from './relay'
import { DEFAULT_TUNNEL_SERVER } from '../core/tunnel'

export type RightTab = 'files' | 'terminal' | 'tasks' | 'network' | 'preview'
export type SearchBackend = 'duckduckgo' | 'brave' | 'tavily' | 'searxng' | 'exa'

export interface SettingsState {
  providers: ProviderConfig[]
  /** "providerId::modelId" */
  selected: string
  params: GenParams
  mode: PermissionMode
  rules: PermissionRules
  guard: GuardConfig
  customPrompt: string
  maxTurns: number
  autoCompact: boolean
  compactThreshold: number
  allowPythonPackages: boolean
  previewCdn: boolean
  search: { backend: SearchBackend; searxngUrl: string }
  disabledTools: string[]
  /** Modelo para resumir páginas de WebFetch ('' = el mismo de la sesión). */
  helperModel: string
  /** URL del relay ('' = /api/relay del propio despliegue). */
  relayUrl: string
  /** Túnel cifrado (TLS en el navegador sobre Wisp) cuando no hay relay. */
  tunnel: { enabled: boolean; server: string }
  ui: { rightPanel: boolean; rightTab: RightTab; sidebar: boolean }
  /** Solo para el saludo de la interfaz; nunca se envía al modelo. */
  userName: string
  onboarded: boolean

  set: (patch: Partial<SettingsState>) => void
  setParams: (patch: Partial<GenParams>) => void
  setGuard: (patch: Partial<GuardConfig>) => void
  setUi: (patch: Partial<SettingsState['ui']>) => void
  addProvider: (presetId: string) => string
  addProviderConfig: (p: ProviderConfig) => void
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void
  removeProvider: (id: string) => void
  setModels: (id: string, models: ModelInfo[]) => void
  addRule: (kind: 'allow' | 'deny', rule: string) => void
  removeRule: (kind: 'allow' | 'deny', rule: string) => void
}

const demo = providerFromPreset(PRESETS[0], 'demo')
const local = providerFromPreset(PRESETS.find((p) => p.id === 'webllm')!, 'webllm')

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: [demo, local],
      selected: `demo::${demo.models[0].id}`,
      params: { reasoningEffort: '' },
      mode: 'acceptEdits',
      rules: DEFAULT_RULES,
      guard: DEFAULT_GUARD,
      customPrompt: '',
      maxTurns: 40,
      autoCompact: true,
      compactThreshold: 0.8,
      allowPythonPackages: false,
      previewCdn: false,
      search: { backend: 'duckduckgo', searxngUrl: '' },
      disabledTools: [],
      helperModel: '',
      relayUrl: '',
      tunnel: { enabled: true, server: DEFAULT_TUNNEL_SERVER },
      ui: { rightPanel: false, rightTab: 'files', sidebar: false },
      userName: '',
      onboarded: false,

      set: (patch) => set(patch),
      setParams: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
      setGuard: (patch) => set((s) => ({ guard: { ...s.guard, ...patch } })),
      setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
      addProvider: (presetId) => {
        const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[PRESETS.length - 1]
        const id = get().providers.some((p) => p.id === preset.id) ? uid(preset.id) : preset.id
        const provider = providerFromPreset(preset, id)
        // Sin relay (p. ej. GitHub Pages) se empieza en directo; si el proveedor
        // bloquea el navegador, la capa de compatibilidad pasa sola al túnel cifrado.
        if (relayState.status === 'missing') provider.connection = 'direct'
        set((s) => ({ providers: [...s.providers, provider] }))
        return id
      },
      addProviderConfig: (p) => set((s) => ({ providers: [...s.providers.filter((x) => x.id !== p.id), p] })),
      updateProvider: (id, patch) => set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeProvider: (id) =>
        set((s) => {
          const providers = s.providers.filter((p) => p.id !== id)
          const selected = s.selected.startsWith(`${id}::`) ? `demo::${demo.models[0].id}` : s.selected
          return { providers: providers.length ? providers : [demo], selected }
        }),
      setModels: (id, models) =>
        set((s) => ({
          providers: s.providers.map((p) => {
            if (p.id !== id) return p
            const known = new Map(p.models.map((m) => [m.id, m]))
            return { ...p, models: models.map((m) => ({ toolMode: 'native' as const, ...m, ...(known.get(m.id) ?? {}) })) }
          }),
        })),
      addRule: (kind, rule) =>
        set((s) => (s.rules[kind].includes(rule) ? s : { rules: { ...s.rules, [kind]: [...s.rules[kind], rule] } })),
      removeRule: (kind, rule) => set((s) => ({ rules: { ...s.rules, [kind]: s.rules[kind].filter((r) => r !== rule) } })),
    }),
    {
      name: 'gh-settings',
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as Partial<SettingsState>
        // v2: añade los modelos locales (WebLLM) a quien ya tenía la app.
        if (version < 2 && Array.isArray(s.providers) && !s.providers.some((p) => p.kind === 'webllm')) {
          s.providers = [...s.providers.slice(0, 1), local, ...s.providers.slice(1)]
        }
        return s as SettingsState
      },
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => {
        // Nunca se persisten funciones; las claves viven en la bóveda.
        const { set: _a, setParams: _b, setGuard: _c, setUi: _d, addProvider: _e, addProviderConfig: _k, updateProvider: _f, removeProvider: _g, setModels: _h, addRule: _i, removeRule: _j, ...rest } = s
        return rest
      },
    },
  ),
)

export function parseModelRef(ref: string): { providerId: string; modelId: string } {
  const i = ref.indexOf('::')
  return i < 0 ? { providerId: ref, modelId: '' } : { providerId: ref.slice(0, i), modelId: ref.slice(i + 2) }
}

export function resolveModel(ref: string): { provider: ProviderConfig; model: ModelInfo } | null {
  const { providerId, modelId } = parseModelRef(ref)
  const provider = useSettings.getState().providers.find((p) => p.id === providerId)
  if (!provider) return null
  const model = provider.models.find((m) => m.id === modelId) ?? (modelId ? { id: modelId, toolMode: 'native' as const } : provider.models[0])
  if (!model) return null
  return { provider, model }
}

export function modelLabel(ref: string): string {
  const r = resolveModel(ref)
  if (!r) return 'Sin modelo'
  return `${r.model.label ?? r.model.id}`
}
