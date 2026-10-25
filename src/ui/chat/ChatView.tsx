import { Bot, Eye, FlaskConical, Globe, Menu, PanelRight, Pencil, Play, ShieldCheck, Sparkles, SquareTerminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ensureSession, sendUserMessage } from '../../app/runtime'
import { useSecrets } from '../../state/secrets'
import { useSessions } from '../../state/sessions'
import { resolveModel, useSettings } from '../../state/settings'
import { useUi } from '../../state/ui'
import { cx } from '../cx'
import { Composer } from './Composer'
import { Interactions } from './Interactions'
import { MessageList } from './MessageList'
import { TodoList } from './ToolCard'

const EXAMPLES = [
  { icon: <Sparkles size={15} />, title: 'Recorrido rápido', prompt: 'Muéstrame lo que puedes hacer en este sandbox' },
  { icon: <Play size={15} />, title: 'Python aislado', prompt: 'Calcula con python la suma de los cuadrados del 1 al 100' },
  { icon: <Eye size={15} />, title: 'Página en vista previa', prompt: 'Haz una página html interactiva y muéstrala' },
  { icon: <ShieldCheck size={15} />, title: 'Prueba el escudo', prompt: 'Simula una fuga de datos para probar la seguridad' },
  { icon: <Bot size={15} />, title: 'Sub-agente', prompt: 'Usa un subagente para revisar el workspace' },
  { icon: <Globe size={15} />, title: 'Preguntas', prompt: 'Pregúntame qué lenguaje prefiero antes de empezar' },
]

function Welcome({ sessionId }: { sessionId: string }) {
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId))
  const resolved = session ? resolveModel(session.modelRef) : null
  const isDemo = resolved?.provider.kind === 'mock'
  const guard = useSettings((s) => s.guard.action)
  const vault = useSecrets((s) => s.vaultExists)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col items-center py-10 text-center sm:py-16">
        <div className="glass mb-5 grid size-16 place-items-center rounded-3xl">
          <img src="/favicon.svg" alt="" className="size-10" />
        </div>
        <h1 className="text-gradient text-3xl font-semibold tracking-tight sm:text-4xl">Glasshouse</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Prueba modelos en los que no confías dentro de una caja de cristal: un sandbox en tu navegador con las herramientas de Claude Code, sin acceso a tu equipo ni a tus datos.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
          <span className="chip">
            <SquareTerminal size={12} /> Bash, Python y JS aislados
          </span>
          <span className={cx('chip', guard === 'off' ? 'text-amber' : 'text-ok')}>
            <ShieldCheck size={12} /> Escudo: {guard === 'block' ? 'bloquear' : guard === 'redact' ? 'redactar' : guard === 'warn' ? 'avisar' : 'apagado'}
          </span>
          <span className="chip">{vault ? 'Claves cifradas' : 'Claves solo en memoria'}</span>
        </div>
        {isDemo && (
          <p className="mt-6 max-w-lg rounded-2xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-50/85">
            Estás usando el <b>modelo Demo</b> (simulado, sin red). Prueba los ejemplos y, cuando quieras, añade un proveedor real en{' '}
            <button className="underline decoration-cyan-300/50 underline-offset-2" onClick={() => useUi.getState().setView('providers')}>
              Proveedores
            </button>
            .
          </p>
        )}
        <div className="mt-8 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXAMPLES.map((ex) => (
            <button key={ex.title} className="glass group rounded-2xl p-4 text-left transition hover:border-white/20 hover:bg-white/[0.07]" onClick={() => void sendUserMessage(sessionId, ex.prompt)}>
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <span className="text-violet-200 transition group-hover:text-cyan">{ex.icon}</span>
                {ex.title}
              </div>
              <div className="mt-1.5 text-xs leading-relaxed text-muted">{ex.prompt}</div>
            </button>
          ))}
        </div>
        <button className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg" onClick={() => useUi.getState().setView('evals')}>
          <FlaskConical size={13} /> ¿Quieres comparar modelos en serio? Prueba las Evals y la Arena
        </button>
      </div>
    </div>
  )
}

function Header({ sessionId }: { sessionId: string }) {
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId))
  const running = useSessions((s) => !!s.running[sessionId])
  const rightPanel = useSettings((s) => s.ui.rightPanel)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const todos = session?.todos ?? []
  const active = todos.find((t) => t.status === 'in_progress')
  const [showTodos, setShowTodos] = useState(false)
  return (
    <header className="relative flex items-center gap-2 border-b border-white/[0.07] px-3 py-2.5 sm:px-5">
      <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => useUi.getState().setMobilePanel('sidebar')} aria-label="Abrir menú">
        <Menu size={17} />
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            className="input py-1"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (title.trim()) useSessions.getState().rename(sessionId, title.trim())
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button
            className="group flex max-w-full items-center gap-2 text-left"
            onClick={() => {
              setTitle(session?.title ?? '')
              setEditing(true)
            }}
          >
            <span className="truncate text-sm font-medium">{session?.title ?? 'Conversación'}</span>
            <Pencil size={12} className="shrink-0 text-faint opacity-0 transition group-hover:opacity-100" />
            {running && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-cyan" aria-label="trabajando" />}
          </button>
        )}
      </div>
      {todos.length > 0 && (
        <div className="relative">
          <button className="chip hover:text-fg" onClick={() => setShowTodos(!showTodos)}>
            {todos.filter((t) => t.status === 'completed').length}/{todos.length} · <span className="max-w-40 truncate">{active?.activeForm ?? active?.content ?? 'tareas'}</span>
          </button>
          {showTodos && (
            <div className="glass-strong absolute right-0 top-full z-30 mt-2 w-80 rounded-2xl p-4 animate-fade-in">
              <TodoList todos={todos} />
            </div>
          )}
        </div>
      )}
      <button
        className={cx('btn btn-ghost btn-icon', rightPanel && 'text-violet-200')}
        onClick={() => {
          if (window.matchMedia('(min-width: 1024px)').matches) useSettings.getState().setUi({ rightPanel: !rightPanel })
          else useUi.getState().setMobilePanel('right')
        }}
        aria-label="Panel de workspace"
        title="Workspace, terminal, red y preview"
      >
        <PanelRight size={17} />
      </button>
    </header>
  )
}

export function ChatView() {
  const currentId = useSessions((s) => s.currentId)
  const exists = useSessions((s) => s.sessions.some((x) => x.id === s.currentId))
  const count = useSessions((s) => (s.currentId ? (s.messages[s.currentId]?.length ?? 0) : 0))
  const loaded = useSessions((s) => (s.currentId ? !!s.loaded[s.currentId] : false))
  useEffect(() => {
    if (!currentId || !exists) ensureSession()
    else if (!loaded) void useSessions.getState().load(currentId)
  }, [currentId, exists, loaded])
  if (!currentId || !exists || !loaded) return null
  const sessionId = currentId
  return (
    <div className="flex h-full min-w-0 flex-col">
      <Header sessionId={sessionId} />
      {count === 0 ? <Welcome sessionId={sessionId} /> : <MessageList sessionId={sessionId} />}
      <Interactions sessionId={sessionId} />
      <Composer sessionId={sessionId} />
    </div>
  )
}
