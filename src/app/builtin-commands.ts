// Comandos / de la propia harness (equivalentes a los de Claude Code).

import { estimateContextTokens } from '../core/agent/compact'
import { MODE_LABELS } from '../core/agent/permissions'
import type { PermissionMode } from '../core/types'
import { formatUsd, uid } from '../core/util'
import { enabledAgents, enabledCommands, enabledSkills } from '../state/extensions'
import { useSessions } from '../state/sessions'
import { resolveModel, useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { getWorkspace } from '../state/workspaces'
import { exportSessionMarkdown, downloadText } from './export'
import { compactSession, runSession, setSessionMode, toolsFor } from './runtime'

export interface BuiltinCommandInfo {
  name: string
  description: string
  args?: string
}

export const BUILTIN_COMMANDS: BuiltinCommandInfo[] = [
  { name: 'help', description: 'Muestra los comandos disponibles' },
  { name: 'new', description: 'Empieza una conversación nueva' },
  { name: 'clear', description: 'Borra los mensajes de esta conversación' },
  { name: 'compact', description: 'Resume la conversación para liberar contexto', args: '[instrucciones]' },
  { name: 'model', description: 'Cambia el modelo de esta conversación', args: 'proveedor::modelo' },
  { name: 'mode', description: 'Cambia el modo de permisos', args: 'default | acceptEdits | plan | bypassPermissions' },
  { name: 'init', description: 'Analiza el workspace y crea AGENTS.md (memoria del proyecto)' },
  { name: 'memory', description: 'Abre /workspace/AGENTS.md en el editor' },
  { name: 'context', description: 'Muestra el uso estimado de contexto' },
  { name: 'cost', description: 'Muestra tokens y coste de esta conversación' },
  { name: 'tools', description: 'Lista las herramientas disponibles' },
  { name: 'skills', description: 'Lista las skills activas' },
  { name: 'agents', description: 'Lista los sub-agentes disponibles' },
  { name: 'plugins', description: 'Abre el gestor de extensiones' },
  { name: 'permissions', description: 'Abre las reglas de permisos' },
  { name: 'export', description: 'Descarga la conversación en Markdown' },
  { name: 'arena', description: 'Abre la Arena para comparar modelos' },
  { name: 'evals', description: 'Abre las evaluaciones' },
]

function info(sessionId: string, content: string) {
  useSessions.getState().push(sessionId, { id: uid('m'), role: 'assistant', content, local: true, createdAt: Date.now() })
}

export async function runBuiltinCommand(sessionId: string, name: string, args: string): Promise<boolean> {
  const sessions = useSessions.getState()
  const ui = useUi.getState()
  const session = sessions.sessions.find((s) => s.id === sessionId)
  switch (name) {
    case 'help': {
      const custom = enabledCommands()
      info(
        sessionId,
        `### Comandos de la harness\n${BUILTIN_COMMANDS.map((c) => `- \`/${c.name}${c.args ? ` ${c.args}` : ''}\` — ${c.description}`).join('\n')}${
          custom.length ? `\n\n### Comandos de plugins y tuyos\n${custom.map((c) => `- \`/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ''}\` — ${c.description}`).join('\n')}` : ''
        }\n\n**Atajos:** \`Ctrl+K\` paleta · \`Shift+Tab\` cambiar modo · \`Esc\` detener · \`@\` mencionar archivo`,
      )
      return true
    }
    case 'new':
      sessions.newSession(useSettings.getState().selected)
      return true
    case 'clear':
      sessions.setMessages(sessionId, [])
      sessions.patch(sessionId, { todos: [] })
      return true
    case 'compact':
      await compactSession(sessionId, args || undefined)
      return true
    case 'model': {
      if (!args) {
        ui.toast('Uso: /model proveedor::modelo (o usa el selector de modelo)')
        return true
      }
      const ref = args.includes('::') ? args : `${useSettings.getState().providers.find((p) => p.models.some((m) => m.id === args))?.id ?? ''}::${args}`
      if (!resolveModel(ref)) {
        ui.toast(`Modelo no encontrado: ${args}`, 'error')
        return true
      }
      sessions.patch(sessionId, { modelRef: ref })
      useSettings.getState().set({ selected: ref })
      ui.toast(`Modelo: ${ref}`, 'success')
      return true
    }
    case 'mode': {
      const mode = args.trim() as PermissionMode
      if (!(mode in MODE_LABELS)) {
        ui.toast('Modos: default, acceptEdits, plan, bypassPermissions', 'error')
        return true
      }
      setSessionMode(sessionId, mode)
      ui.toast(`Modo: ${MODE_LABELS[mode].label}`, 'success')
      return true
    }
    case 'init': {
      sessions.push(sessionId, {
        id: uid('m'),
        role: 'user',
        content:
          'Analyze this workspace and create /workspace/AGENTS.md: a concise guide for future AI agents with the project purpose, structure, how to run and test it, conventions and gotchas. If AGENTS.md already exists, improve it. Keep it short and practical.',
        createdAt: Date.now(),
        meta: { expandedFrom: '/init' },
      })
      await runSession(sessionId)
      return true
    }
    case 'memory': {
      const ws = await getWorkspace(sessionId)
      if (!(await ws.exists('/workspace/AGENTS.md'))) {
        await ws.writeFile('/workspace/AGENTS.md', '# Memoria del proyecto\n\nInstrucciones que el agente leerá en cada conversación de este workspace.\n')
      }
      ui.setOpenFile('/workspace/AGENTS.md')
      useSettings.getState().setUi({ rightPanel: true, rightTab: 'files' })
      return true
    }
    case 'context': {
      const msgs = sessions.messages[sessionId] ?? []
      const used = estimateContextTokens('', msgs)
      const r = session && resolveModel(session.modelRef)
      const max = r?.model.contextWindow
      info(sessionId, `**Contexto estimado:** ~${used.toLocaleString('es')} tokens${max ? ` de ${max.toLocaleString('es')} (${Math.round((used / max) * 100)}%)` : ''}.\nMensajes activos: ${msgs.filter((m) => !m.archived && !m.local).length}. Usa \`/compact\` para resumir.`)
      return true
    }
    case 'cost':
      info(sessionId, `**Esta conversación:** ${(session?.tokens ?? 0).toLocaleString('es')} tokens · ${formatUsd(session?.costUsd)} (según los precios configurados en Proveedores).`)
      return true
    case 'tools': {
      const tools = await toolsFor()
      info(sessionId, `### Herramientas (${tools.length})\n${tools.map((t) => `- **${t.name}**${t.source ? ` _(${t.source})_` : ''} — ${t.description.split('\n')[0]}`).join('\n')}`)
      return true
    }
    case 'skills': {
      const skills = enabledSkills()
      info(sessionId, skills.length ? `### Skills activas\n${skills.map((s) => `- **${s.name}** — ${s.description}`).join('\n')}` : 'No hay skills activas. Añádelas en Extensiones.')
      return true
    }
    case 'agents':
      info(sessionId, `### Sub-agentes\n${enabledAgents().map((a) => `- **${a.name}** — ${a.description}`).join('\n')}`)
      return true
    case 'plugins':
      ui.setView('extensions')
      return true
    case 'permissions':
      ui.setView('settings')
      return true
    case 'export':
      if (session) downloadText(`${session.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'conversacion'}.md`, exportSessionMarkdown(session, sessions.messages[sessionId] ?? []), 'text/markdown')
      return true
    case 'arena':
      ui.setView('arena')
      return true
    case 'evals':
      ui.setView('evals')
      return true
    default:
      return false
  }
}
