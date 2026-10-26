import { History, Plus, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSessions } from '../state/sessions'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { cx } from './cx'
import { initials, NAV, SETTINGS_NAV } from './nav'

function RailButton({ label, active, onClick, children, badge }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'peer relative grid size-11 place-items-center rounded-full border transition',
          active
            ? 'border-white/15 bg-accent-strong text-white shadow-[0_10px_28px_-10px_rgba(29,140,240,0.95)]'
            : 'border-white/[0.06] bg-white/[0.05] text-muted hover:border-white/15 hover:bg-white/10 hover:text-fg',
        )}
      >
        {children}
        {badge}
      </button>
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-full border border-white/10 bg-ink-800/95 px-3 py-1 text-xs text-fg opacity-0 shadow-lg transition group-hover:opacity-100 peer-focus-visible:opacity-100">
        {label}
      </span>
    </div>
  )
}

/** Riel de iconos del escritorio (navegación principal). */
export function Rail() {
  const view = useUi((s) => s.view)
  const guard = useSettings((s) => s.guard.action)
  const historyOpen = useSettings((s) => s.ui.sidebar)
  const userName = useSettings((s) => s.userName)
  const go = useUi((s) => s.setView)
  const Settings = SETTINGS_NAV.Icon

  return (
    <nav className="flex w-[4.75rem] shrink-0 flex-col items-center gap-2.5 py-5" aria-label="Secciones">
      <button className="mb-3 text-[17px] font-extrabold tracking-tight text-white" onClick={() => go('chat')} aria-label="ISC AGENT: ir al chat">
        ISC
      </button>
      <RailButton
        label="Nueva conversación"
        onClick={() => {
          useSessions.getState().newSession(useSettings.getState().selected)
          go('chat')
        }}
      >
        <Plus size={18} />
      </RailButton>
      <div className="my-1 h-px w-7 bg-white/[0.08]" />
      {NAV.map(({ id, label, Icon }) => (
        <RailButton
          key={id}
          label={label}
          active={view === id}
          onClick={() => go(id)}
          badge={id === 'security' && <span className={cx('absolute right-0.5 top-0.5 size-2 rounded-full ring-2 ring-ink-900', guard === 'off' ? 'bg-amber' : 'bg-ok')} aria-hidden />}
        >
          <Icon size={17} />
        </RailButton>
      ))}

      <div className="flex-1" />

      <RailButton label={historyOpen ? 'Ocultar historial' : 'Historial'} active={historyOpen} onClick={() => useSettings.getState().setUi({ sidebar: !historyOpen })}>
        <History size={17} />
      </RailButton>
      <RailButton label={SETTINGS_NAV.label} active={view === 'settings'} onClick={() => go('settings')}>
        <Settings size={17} />
      </RailButton>
      <button
        className="mt-1 grid size-11 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-sky-400 via-indigo-500 to-teal-400 text-[13px] font-bold text-white shadow-inner"
        onClick={() => go('settings')}
        aria-label={userName ? `Perfil: ${userName}` : 'Perfil'}
        title={userName || 'Pon tu nombre en Ajustes'}
      >
        {userName ? initials(userName) : <User size={17} />}
      </button>
    </nav>
  )
}
