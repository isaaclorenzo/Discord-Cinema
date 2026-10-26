import { Command, Cpu, MessageSquare, Slash, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BUILTIN_COMMANDS } from '../app/builtin-commands'
import { ensureSession, sendUserMessage, setSessionMode } from '../app/runtime'
import { MODE_LABELS, MODE_ORDER } from '../core/agent/permissions'
import { useSessions } from '../state/sessions'
import { useSettings } from '../state/settings'
import { useUi, type View } from '../state/ui'
import { cx } from './cx'

interface Action {
  id: string
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

const VIEWS: Array<[View, string]> = [
  ['chat', 'Ir al chat'],
  ['arena', 'Abrir la Arena'],
  ['evals', 'Abrir las Evals'],
  ['extensions', 'Gestionar extensiones (skills, plugins, MCP)'],
  ['providers', 'Configurar proveedores y claves'],
  ['security', 'Seguridad y privacidad'],
  ['settings', 'Ajustes'],
]

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPalette)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const next = !useUi.getState().paletteOpen
        if (next) {
          setQ('')
          setActive(0)
        }
        setOpen(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus())
  }, [open])

  const actions = useMemo<Action[]>(() => {
    if (!open) return []
    const close = () => setOpen(false)
    const list: Action[] = [
      {
        id: 'new',
        label: 'Nueva conversación',
        icon: <MessageSquare size={14} />,
        run: () => {
          useSessions.getState().newSession(useSettings.getState().selected)
          useUi.getState().setView('chat')
          close()
        },
      },
      ...VIEWS.map(([v, label]) => ({ id: `view:${v}`, label, icon: <Zap size={14} />, run: () => (useUi.getState().setView(v), close()) })),
      ...BUILTIN_COMMANDS.map((c) => ({
        id: `cmd:${c.name}`,
        label: `/${c.name}`,
        hint: c.description,
        icon: <Slash size={14} />,
        run: () => {
          close()
          useUi.getState().setView('chat')
          void sendUserMessage(ensureSession(), `/${c.name}`)
        },
      })),
      ...MODE_ORDER.map((m) => ({
        id: `mode:${m}`,
        label: `Modo: ${MODE_LABELS[m].label}`,
        hint: MODE_LABELS[m].hint,
        icon: <Command size={14} />,
        run: () => (setSessionMode(ensureSession(), m), close()),
      })),
      ...useSettings
        .getState()
        .providers.flatMap((p) => p.models.map((m) => ({ p, m })))
        .map(({ p, m }) => ({
          id: `model:${p.id}::${m.id}`,
          label: `Modelo: ${m.label ?? m.id}`,
          hint: p.name,
          icon: <Cpu size={14} />,
          run: () => {
            const ref = `${p.id}::${m.id}`
            useSessions.getState().patch(ensureSession(), { modelRef: ref })
            useSettings.getState().set({ selected: ref })
            close()
          },
        })),
      ...useSessions.getState().sessions.map((s) => ({
        id: `session:${s.id}`,
        label: s.title,
        hint: 'conversación',
        icon: <MessageSquare size={14} />,
        run: () => {
          useSessions.getState().select(s.id)
          useUi.getState().setView('chat')
          close()
        },
      })),
    ]
    return list
  }, [open, setOpen])

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim()
    if (!t) return actions.slice(0, 40)
    return actions.filter((a) => `${a.label} ${a.hint ?? ''}`.toLowerCase().includes(t)).slice(0, 40)
  }, [q, actions])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm animate-fade-in" onMouseDown={() => setOpen(false)}>
      <div className="glass-strong w-full max-w-xl overflow-hidden rounded-3xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Paleta de comandos">
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') filtered[active]?.run()
          }}
          placeholder="Busca una acción, comando, modelo o conversación…"
          className="w-full border-b border-white/10 bg-transparent px-5 py-4 text-[15px] text-fg placeholder:text-faint focus:outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.map((a, i) => (
            <button
              key={a.id}
              onMouseEnter={() => setActive(i)}
              onClick={a.run}
              className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px]', i === active ? 'bg-white/10' : 'hover:bg-white/5')}
            >
              <span className="text-sky-200">{a.icon}</span>
              <span className="truncate">{a.label}</span>
              {a.hint && <span className="ml-auto truncate pl-3 text-xs text-faint">{a.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Sin resultados</p>}
        </div>
      </div>
    </div>
  )
}
