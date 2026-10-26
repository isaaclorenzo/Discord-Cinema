import { Bot, Eye, FlaskConical, Globe, Menu, PanelRight, Pencil, Play, ShieldCheck, Sparkles, SquareTerminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ensureSession, sendUserMessage } from '../../app/runtime'
import { useSecrets } from '../../state/secrets'
import { useSessions } from '../../state/sessions'
import { useSettings } from '../../state/settings'
import { useUi } from '../../state/ui'
import { cx } from '../cx'
import { Composer } from './Composer'
import { Interactions } from './Interactions'
import { LocalModelStatus } from './LocalModelStatus'
import { MessageList } from './MessageList'
import { TodoList } from './ToolCard'

const MAIN_EXAMPLES = [
  { icon: <Sparkles size={17} />, title: 'Recorrido rápido', desc: 'Descubre las herramientas del sandbox en un minuto.', prompt: 'Muéstrame lo que puedes hacer en este sandbox' },
  { icon: <Play size={17} />, title: 'Python aislado', desc: 'Ejecuta código sin tocar tu equipo ni la red.', prompt: 'Calcula con python la suma de los cuadrados del 1 al 100' },
  { icon: <Eye size={17} />, title: 'Página en vista previa', desc: 'Crea una web interactiva y mírala al instante.', prompt: 'Haz una página html interactiva y muéstrala' },
]

const MORE_EXAMPLES = [
  { icon: <ShieldCheck size={13} />, title: 'Prueba el escudo', prompt: 'Simula una fuga de datos para probar la seguridad' },
  { icon: <Bot size={13} />, title: 'Sub-agente', prompt: 'Usa un subagente para revisar el workspace' },
  { icon: <Globe size={13} />, title: 'Preguntas', prompt: 'Pregúntame qué lenguaje prefiero antes de empezar' },
]

function Welcome({ sessionId }: { sessionId: string }) {
  const guard = useSettings((s) => s.guard.action)
  const userName = useSettings((s) => s.userName.trim().split(/\s+/)[0] ?? '')
  const vault = useSecrets((s) => s.vaultExists)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center py-8 text-center sm:py-12">
        <div className="orb size-20 animate-float sm:size-28" aria-hidden />
        <p className="mt-6 text-lg sm:mt-8 font-medium text-muted">Hola{userName ? `, ${userName}` : ''}</p>
        <h1 className="mt-1 text-[2rem] font-extrabold leading-tight tracking-tight text-white sm:text-[2.6rem]">¿En qué te ayudo hoy?</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Prueba cualquier modelo dentro de un sandbox en tu navegador, con las herramientas de Claude Code y sin acceso a tu equipo ni a tus datos.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
          <span className="chip">
            <SquareTerminal size={12} /> Bash, Python y JS aislados
          </span>
          <span className={cx('chip', guard === 'off' ? 'text-amber' : 'text-ok')}>
            <ShieldCheck size={12} /> Escudo: {guard === 'block' ? 'bloquear' : guard === 'redact' ? 'redactar' : guard === 'warn' ? 'avisar' : 'apagado'}
          </span>
          <span className="chip">{vault ? 'Claves cifradas' : 'Claves solo en memoria'}</span>
        </div>

        <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
          {MAIN_EXAMPLES.map((ex) => (
            <button
              key={ex.title}
              className="glass group grid grid-cols-[auto_1fr] items-center gap-x-3 rounded-3xl p-3.5 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] sm:flex sm:flex-col sm:items-start sm:p-4"
              onClick={() => void sendUserMessage(sessionId, ex.prompt)}
            >
              <span className="row-span-2 grid size-9 place-items-center rounded-full bg-white/[0.07] text-accent transition group-hover:bg-accent-strong group-hover:text-white">{ex.icon}</span>
              <span className="text-sm font-semibold text-fg sm:mt-3">{ex.title}</span>
              <span className="text-xs leading-relaxed text-muted sm:mt-1">{ex.desc}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {MORE_EXAMPLES.map((ex) => (
            <button key={ex.title} className="chip px-3 py-1 hover:border-white/20 hover:text-fg" onClick={() => void sendUserMessage(sessionId, ex.prompt)}>
              {ex.icon} {ex.title}
            </button>
          ))}
          <button className="chip px-3 py-1 hover:border-white/20 hover:text-fg" onClick={() => useUi.getState().setView('evals')}>
            <FlaskConical size={13} /> Evals y Arena
          </button>
        </div>

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
    <header className="relative flex items-center gap-2 px-3 py-3 sm:px-5">
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
        className={cx('btn btn-ghost btn-icon', rightPanel && 'text-sky-200')}
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
      <LocalModelStatus />
      <Interactions sessionId={sessionId} />
      <Composer sessionId={sessionId} />
    </div>
  )
}
