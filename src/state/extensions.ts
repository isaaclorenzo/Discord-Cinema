// Skills, plugins, comandos, agentes, hooks, servidores MCP y suites de evals
// instalados por el usuario (más los incluidos de serie).

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { BUILTIN_AGENTS } from '../core/extensions/builtin-agents'
import type { AgentDef, EvalSuite, HookDef, McpServerDef, Plugin, PluginToolDef, Skill, SlashCommand } from '../core/extensions/types'
import { idbStorage } from '../core/storage/db'
import { BUILTIN_PLUGINS, BUILTIN_SKILLS, BUILTIN_EVALS } from '../builtin'

interface ExtensionsState {
  /** Skills sueltas del usuario. */
  skills: Skill[]
  commands: SlashCommand[]
  agents: AgentDef[]
  hooks: HookDef[]
  mcpServers: McpServerDef[]
  tools: PluginToolDef[]
  evals: EvalSuite[]
  plugins: Plugin[]
  /** Activación de los elementos de serie (id → activo). */
  builtinEnabled: Record<string, boolean>

  upsertSkill: (s: Skill) => void
  removeSkill: (id: string) => void
  upsertCommand: (c: SlashCommand) => void
  removeCommand: (id: string) => void
  upsertAgent: (a: AgentDef) => void
  removeAgent: (id: string) => void
  upsertHook: (h: HookDef) => void
  removeHook: (id: string) => void
  upsertMcp: (m: McpServerDef) => void
  removeMcp: (id: string) => void
  upsertTool: (t: PluginToolDef) => void
  removeTool: (id: string) => void
  upsertEval: (e: EvalSuite) => void
  removeEval: (id: string) => void
  installPlugin: (p: Plugin) => void
  removePlugin: (id: string) => void
  togglePlugin: (id: string, enabled: boolean) => void
  toggleItem: (id: string, enabled: boolean) => void
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

export const useExtensions = create<ExtensionsState>()(
  persist(
    (set) => ({
      skills: [],
      commands: [],
      agents: [],
      hooks: [],
      mcpServers: [],
      tools: [],
      evals: [],
      plugins: [],
      builtinEnabled: {},

      upsertSkill: (s) => set((st) => ({ skills: upsert(st.skills, s) })),
      removeSkill: (id) => set((st) => ({ skills: st.skills.filter((x) => x.id !== id) })),
      upsertCommand: (c) => set((st) => ({ commands: upsert(st.commands, c) })),
      removeCommand: (id) => set((st) => ({ commands: st.commands.filter((x) => x.id !== id) })),
      upsertAgent: (a) => set((st) => ({ agents: upsert(st.agents, a) })),
      removeAgent: (id) => set((st) => ({ agents: st.agents.filter((x) => x.id !== id) })),
      upsertHook: (h) => set((st) => ({ hooks: upsert(st.hooks, h) })),
      removeHook: (id) => set((st) => ({ hooks: st.hooks.filter((x) => x.id !== id) })),
      upsertMcp: (m) => set((st) => ({ mcpServers: upsert(st.mcpServers, m) })),
      removeMcp: (id) => set((st) => ({ mcpServers: st.mcpServers.filter((x) => x.id !== id) })),
      upsertTool: (t) => set((st) => ({ tools: upsert(st.tools, t) })),
      removeTool: (id) => set((st) => ({ tools: st.tools.filter((x) => x.id !== id) })),
      upsertEval: (e) => set((st) => ({ evals: upsert(st.evals, e) })),
      removeEval: (id) => set((st) => ({ evals: st.evals.filter((x) => x.id !== id) })),
      installPlugin: (p) => set((st) => ({ plugins: upsert(st.plugins, p) })),
      removePlugin: (id) => set((st) => ({ plugins: st.plugins.filter((x) => x.id !== id) })),
      togglePlugin: (id, enabled) =>
        set((st) => {
          if (st.plugins.some((p) => p.id === id)) return { plugins: st.plugins.map((p) => (p.id === id ? { ...p, enabled } : p)) }
          return { builtinEnabled: { ...st.builtinEnabled, [id]: enabled } }
        }),
      toggleItem: (id, enabled) =>
        set((st) => {
          const flip = <T extends { id: string; enabled: boolean }>(list: T[]) => list.map((x) => (x.id === id ? { ...x, enabled } : x))
          if (id.startsWith('builtin:')) return { builtinEnabled: { ...st.builtinEnabled, [id]: enabled } }
          return {
            skills: flip(st.skills),
            commands: flip(st.commands),
            agents: flip(st.agents),
            hooks: flip(st.hooks),
            mcpServers: flip(st.mcpServers),
            tools: flip(st.tools),
            plugins: st.plugins.map((p) => ({
              ...p,
              skills: flip(p.skills),
              commands: flip(p.commands),
              agents: flip(p.agents),
              hooks: flip(p.hooks),
              mcpServers: flip(p.mcpServers),
              tools: flip(p.tools),
            })),
          }
        }),
    }),
    {
      name: 'gh-extensions',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        skills: s.skills,
        commands: s.commands,
        agents: s.agents,
        hooks: s.hooks,
        mcpServers: s.mcpServers,
        tools: s.tools,
        evals: s.evals,
        plugins: s.plugins,
        builtinEnabled: s.builtinEnabled,
      }),
    },
  ),
)

// ---------------------------------------------------------------------------
// Vistas combinadas (de serie + plugins + usuario), solo lo activo.
// ---------------------------------------------------------------------------

function builtinOn(id: string, fallback = true): boolean {
  return useExtensions.getState().builtinEnabled[id] ?? fallback
}

export function allPlugins(): Plugin[] {
  const s = useExtensions.getState()
  const builtins = BUILTIN_PLUGINS.map((p) => ({ ...p, enabled: builtinOn(p.id, p.enabled) }))
  return [...builtins, ...s.plugins]
}

function activePlugins(): Plugin[] {
  return allPlugins().filter((p) => p.enabled)
}

function on<T extends { id: string; enabled: boolean }>(x: T): boolean {
  return x.id.startsWith('builtin:') ? builtinOn(x.id, x.enabled) : x.enabled
}

export function enabledSkills(): Skill[] {
  const s = useExtensions.getState()
  return [...BUILTIN_SKILLS, ...activePlugins().flatMap((p) => p.skills), ...s.skills].filter(on)
}

export function enabledCommands(): SlashCommand[] {
  const s = useExtensions.getState()
  return [...activePlugins().flatMap((p) => p.commands), ...s.commands].filter(on)
}

export function enabledAgents(): AgentDef[] {
  const s = useExtensions.getState()
  return [...BUILTIN_AGENTS, ...activePlugins().flatMap((p) => p.agents), ...s.agents].filter(on)
}

export function enabledHooks(): HookDef[] {
  const s = useExtensions.getState()
  return [...activePlugins().flatMap((p) => p.hooks), ...s.hooks].filter(on)
}

export function enabledMcpServers(): McpServerDef[] {
  const s = useExtensions.getState()
  return [...activePlugins().flatMap((p) => p.mcpServers), ...s.mcpServers].filter(on)
}

export function enabledPluginTools(): PluginToolDef[] {
  const s = useExtensions.getState()
  return [...activePlugins().flatMap((p) => p.tools), ...s.tools].filter(on)
}

export function allEvalSuites(): EvalSuite[] {
  const s = useExtensions.getState()
  return [...BUILTIN_EVALS, ...activePlugins().flatMap((p) => p.evals), ...s.evals]
}

/** Archivos de un plugin activo, para montarlos en /plugins/<nombre>. */
export function pluginFiles(): Array<{ name: string; files: Record<string, string> }> {
  return activePlugins().map((p) => ({ name: p.name, files: p.files }))
}
