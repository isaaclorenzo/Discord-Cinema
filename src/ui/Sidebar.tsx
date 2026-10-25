import { FlaskConical, MessageSquarePlus, MessagesSquare, Puzzle, Search, Server, Settings, ShieldCheck, Swords, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { stopSession } from '../app/runtime'
import { useSessions } from '../state/sessions'
import { useSettings } from '../state/settings'
import { useUi, type View } from '../state/ui'
import { cx } from './cx'
import { assetUrl } from '../core/sandbox/host'

const NAV: Array<{ id: View; label: string; icon: ReactNode }> = [
  { id: 'chat', label: 'Chat', icon: <MessagesSquare size={16} /> },
  { id: 'arena', label: 'Arena', icon: <Swords size={16} /> },
  { id: 'evals', label: 'Evals', icon: <FlaskConical size={16} /> },
  { id: 'extensions', label: 'Extensiones', icon: <Puzzle size={16} /> },
  { id: 'providers', label: 'Proveedores', icon: <Server size={16} /> },
  { id: 'security', label: 'Seguridad', icon: <ShieldCheck size={16} /> },
  { id: 'settings', label: 'Ajustes', icon: <Settings size={16} /> },
]

function relTime(t: number): string {
  const d = (Date.now() - t) / 1000
  if (d < 60) return 'ahora'
  if (d < 3600) return `${Math.floor(d / 60)} min`
  if (d < 86400) return `${Math.floor(d / 3600)} h`
  return new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const sessions = useSessions((s) => s.sessions)
  const currentId = useSessions((s) => s.currentId)
  const running = useSessions((s) => s.running)
  const view = useUi((s) => s.view)
  const guard = useSettings((s) => s.guard.action)
  const [q, setQ] = useState('')
  const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())) : sessions

  const go = (v: View) => {
    useUi.getState().setView(v)
    onClose?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <img src={assetUrl('favicon.svg')} alt="" className="size-8" />
        <div className="min-w-0 flex-1">
          <div className="text-gradient text-[15px] font-semibold leading-tight">Glasshouse</div>
          <div className="text-[11px] text-faint">harness aislada de modelos</div>
        </div>
        {onClose && (
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar menú">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="px-3">
        <button
          className="btn btn-primary w-full justify-start py-2"
          onClick={() => {
            useSessions.getState().newSession(useSettings.getState().selected)
            go('chat')
          }}
        >
          <MessageSquarePlus size={16} /> Nueva conversación
        </button>
      </div>

      <nav className="mt-3 space-y-0.5 px-3" aria-label="Secciones">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => go(n.id)}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition',
              view === n.id ? 'bg-white/10 text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-muted hover:bg-white/5 hover:text-fg',
            )}
          >
            <span className={cx(view === n.id && 'text-violet-200')}>{n.icon}</span>
            {n.label}
            {n.id === 'security' && <span className={cx('ml-auto size-1.5 rounded-full', guard === 'off' ? 'bg-amber' : 'bg-ok')} aria-hidden />}
          </button>
        ))}
      </nav>

      <div className="mx-3 mt-4 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-2.5">
        <Search size={13} className="text-faint" />
        <input className="w-full bg-transparent py-1.5 text-xs text-fg placeholder:text-faint focus:outline-none" placeholder="Buscar conversaciones" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {filtered.map((s) => (
          <div
            key={s.id}
            className={cx(
              'group flex items-center gap-2 rounded-xl px-2.5 py-2 transition',
              s.id === currentId && view === 'chat' ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]',
            )}
          >
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                useSessions.getState().select(s.id)
                go('chat')
              }}
            >
              <div className="flex items-center gap-1.5">
                {running[s.id] && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-cyan" />}
                <span className="truncate text-[13px] text-fg/90">{s.title}</span>
              </div>
              <div className="truncate text-[11px] text-faint">
                {relTime(s.updatedAt)} · {s.modelRef.split('::')[1] ?? s.modelRef}
              </div>
            </button>
            <button
              className="btn btn-ghost btn-icon shrink-0 opacity-0 transition hover:text-rose-200 group-hover:opacity-100 focus:opacity-100"
              aria-label={`Borrar ${s.title}`}
              onClick={() => {
                if (!confirm(`¿Borrar "${s.title}" y su workspace?`)) return
                stopSession(s.id)
                useSessions.getState().remove(s.id)
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {filtered.length === 0 && <p className="px-3 py-4 text-center text-xs text-faint">Sin conversaciones</p>}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-3 text-[11px] text-faint">
        <span className="kbd">Ctrl</span> <span className="kbd">K</span> paleta de comandos
      </div>
    </div>
  )
}
