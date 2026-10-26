import { useEffect, useState } from 'react'
import { useExtensions } from './state/extensions'
import { useRelay } from './state/relay'
import { useSecrets } from './state/secrets'
import { useSessions } from './state/sessions'
import { useSettings } from './state/settings'
import { useUi } from './state/ui'
import { Background } from './ui/Background'
import { CommandPalette } from './ui/CommandPalette'
import { Rail } from './ui/Rail'
import { SessionsPanel, Sidebar } from './ui/Sidebar'
import { Toasts } from './ui/Toasts'
import { ChatView } from './ui/chat/ChatView'
import { cx } from './ui/cx'
import { useMediaQuery } from './ui/hooks'
import { RightPanel } from './ui/panels/RightPanel'
import { Spinner } from './ui/primitives'
import { VaultUnlock } from './ui/VaultUnlock'
import { ArenaView } from './ui/views/ArenaView'
import { EvalsView } from './ui/views/EvalsView'
import { ExtensionsView } from './ui/views/ExtensionsView'
import { ProvidersView } from './ui/views/ProvidersView'
import { SecurityView } from './ui/views/SecurityView'
import { SettingsView } from './ui/views/SettingsView'

const PERSISTED = [useSettings, useSessions, useExtensions]

function useHydrated(): boolean {
  const [ready, setReady] = useState(() => PERSISTED.every((s) => s.persist.hasHydrated()))
  useEffect(() => {
    void useSecrets.getState().init()
    if (ready) return
    const check = () => setReady(PERSISTED.every((s) => s.persist.hasHydrated()))
    const unsubs = PERSISTED.map((s) => s.persist.onFinishHydration(check))
    check()
    return () => unsubs.forEach((u) => u())
  }, [ready])
  return ready
}

function MainView() {
  const view = useUi((s) => s.view)
  switch (view) {
    case 'arena':
      return <ArenaView />
    case 'evals':
      return <EvalsView />
    case 'extensions':
      return <ExtensionsView />
    case 'providers':
      return <ProvidersView />
    case 'security':
      return <SecurityView />
    case 'settings':
      return <SettingsView />
    default:
      return <ChatView />
  }
}

export default function App() {
  const ready = useHydrated()
  const view = useUi((s) => s.view)
  const mobilePanel = useUi((s) => s.mobilePanel)
  const setMobilePanel = useUi((s) => s.setMobilePanel)
  const rightPanel = useSettings((s) => s.ui.rightPanel)
  const historyOpen = useSettings((s) => s.ui.sidebar)
  const currentId = useSessions((s) => s.currentId)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const relayUrl = useSettings((s) => s.relayUrl)
  const secretsReady = useSecrets((s) => s.ready)
  const relayToken = useSecrets((s) => s.keys.relay ?? '')

  useEffect(() => {
    if (ready && secretsReady) void useRelay.getState().check(relayUrl, relayToken)
  }, [ready, secretsReady, relayUrl, relayToken])

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <Background />
        <Spinner size={22} />
      </div>
    )
  }

  const showRight = view === 'chat' && !!currentId
  return (
    <div className="h-full lg:p-3">
      <Background />
      {/* Ventana de la app: marco redondeado en escritorio, pantalla completa en móvil */}
      <div className="app-frame relative flex h-full overflow-hidden lg:rounded-[2.25rem] lg:border lg:border-white/[0.08] lg:shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
        {desktop && <Rail />}
        {desktop && historyOpen && (
          <aside className="glass w-64 shrink-0 border-y-0 border-l-0 animate-fade-in" style={{ borderRadius: 0 }}>
            <SessionsPanel />
          </aside>
        )}

        <main className="min-w-0 flex-1">
          <MainView />
        </main>

        {showRight && desktop && rightPanel && (
          <aside className="glass w-[min(34rem,38vw)] shrink-0 border-y-0 border-r-0" style={{ borderRadius: 0 }}>
            <RightPanel sessionId={currentId!} onClose={() => useSettings.getState().setUi({ rightPanel: false })} />
          </aside>
        )}
      </div>

      {!desktop && mobilePanel !== 'none' && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setMobilePanel('none')}>
          <div
            className={cx(
              'glass-strong absolute bottom-0 top-0 w-[min(22rem,88vw)]',
              mobilePanel === 'sidebar' ? 'left-0 rounded-r-3xl' : 'right-0 w-[min(40rem,100vw)] rounded-l-3xl',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {mobilePanel === 'sidebar' ? <Sidebar onClose={() => setMobilePanel('none')} /> : currentId && <RightPanel sessionId={currentId} onClose={() => setMobilePanel('none')} />}
          </div>
        </div>
      )}

      <CommandPalette />
      <VaultUnlock />
      <Toasts />
    </div>
  )
}
