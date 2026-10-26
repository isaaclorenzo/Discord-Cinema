import { Plus, Search, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { stopSession } from '../app/runtime'
import { useSessions } from '../state/sessions'
import { useSettings } from '../state/settings'
import { useUi, type View } from '../state/ui'
import { cx } from './cx'
import { NAV, SETTINGS_NAV } from './nav'

function relTime(t: number): string {
  const d = (Date.now() - t) / 1000
  if (d < 60) return 'ahora'
  if (d < 3600) return `${Math.floor(d / 60)} min`
  if (d < 86400) return `${Math.floor(d / 3600)} h`
  return new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

function newConversation() {
  useSessions.getState().newSession(useSettings.getState().selected)
  useUi.getState().setView('chat')
}

/** Buscador y lista de conversaciones (panel de historial y cajón móvil). */
function SessionList({ onPick }: { onPick?: () => void }) {
  const sessions = useSessions((s) => s.sessions)
  const currentId = useSessions((s) => s.currentId)
  const running = useSessions((s) => s.running)
  const view = useUi((s) => s.view)
  const [q, setQ] = useState('')
  const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())) : sessions

  return (
    <>
      <div className="mx-3 flex items-center gap-2 rounded-full border border-white/[0.07] bg-black/25 px-3">
        <Search size={13} className="text-faint" />
        <input className="w-full bg-transparent py-2 text-xs text-fg placeholder:text-faint focus:outline-none" placeholder="Buscar conversaciones" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {filtered.map((s) => (
          <div
            key={s.id}
            className={cx(
              'group flex items-center gap-2 rounded-2xl px-3 py-2 transition',
              s.id === currentId && view === 'chat' ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]',
            )}
          >
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                useSessions.getState().select(s.id)
                useUi.getState().setView('chat')
                onPick?.()
              }}
            >
              <div className="flex items-center gap-1.5">
                {running[s.id] && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
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
    </>
  )
}

/** Panel de historial plegable junto al riel (escritorio). */
export function SessionsPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col pt-5">
      <div className="flex items-center justify-between px-4 pb-3">
        <h2 className="text-sm font-semibold">Historial</h2>
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-icon" onClick={newConversation} aria-label="Nueva conversación" title="Nueva conversación">
            <Plus size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => useSettings.getState().setUi({ sidebar: false })} aria-label="Cerrar historial">
            <X size={15} />
          </button>
        </div>
      </div>
      <SessionList />
    </div>
  )
}

/** Menú completo para el cajón móvil. */
export function Sidebar({ onClose }: { onClose?: () => void }) {
  const view = useUi((s) => s.view)
  const guard = useSettings((s) => s.guard.action)

  const go = (v: View) => {
    useUi.getState().setView(v)
    onClose?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-4 pb-3 pt-5">
        <span className="orb orb-sm size-8 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold leading-tight tracking-tight">ISC AGENT</div>
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
          className="btn btn-primary w-full rounded-full py-2"
          onClick={() => {
            newConversation()
            onClose?.()
          }}
        >
          <Plus size={16} /> Nueva conversación
        </button>
      </div>

      <nav className="mt-3 space-y-0.5 px-3" aria-label="Secciones">
        {[...NAV, SETTINGS_NAV].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={cx('flex w-full items-center gap-3 rounded-full px-2 py-1.5 text-[13px] transition', view === id ? 'text-fg' : 'text-muted hover:bg-white/5 hover:text-fg')}
          >
            <span className={cx('grid size-8 place-items-center rounded-full', view === id ? 'bg-accent-strong text-white' : 'bg-white/[0.06]')}>
              <Icon size={15} />
            </span>
            {label}
            {id === 'security' && <span className={cx('ml-auto mr-2 size-1.5 rounded-full', guard === 'off' ? 'bg-amber' : 'bg-ok')} aria-hidden />}
          </button>
        ))}
      </nav>

      <div className="mb-2 mt-4 px-4 text-[11px] font-semibold uppercase tracking-wide text-faint">Historial</div>
      <SessionList onPick={onClose} />
    </div>
  )
}
