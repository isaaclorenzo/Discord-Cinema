import { ArrowUpRight, Eye, FolderTree, ListTodo, SquareTerminal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { python } from '../../core/sandbox/python'
import { useNetlog } from '../../core/security/netlog'
import { useSessions } from '../../state/sessions'
import { useSettings, type RightTab } from '../../state/settings'
import { useUi } from '../../state/ui'
import { Empty, Spinner, Tabs } from '../primitives'
import { TodoList } from '../chat/ToolCard'
import { FilesPanel } from './FilesPanel'
import { NetworkPanel } from './NetworkPanel'
import { PreviewPanel } from './PreviewPanel'
import { TerminalPanel } from './TerminalPanel'

const NO_TODOS: never[] = []

function TasksPanel({ sessionId }: { sessionId: string }) {
  const todos = useSessions((s) => s.sessions.find((x) => x.id === sessionId)?.todos ?? NO_TODOS)
  const [pyStatus, setPyStatus] = useState(python.status)
  useEffect(() => python.onStatus(setPyStatus), [])
  return (
    <div className="h-full overflow-y-auto p-4">
      {pyStatus && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs text-cyan-50/80">
          <Spinner size={12} /> {pyStatus}
        </div>
      )}
      {todos.length ? (
        <TodoList todos={todos} />
      ) : (
        <Empty icon={<ListTodo size={22} />} title="Sin tareas">
          Cuando el modelo planifique con TodoWrite, verás aquí su lista de tareas en vivo.
        </Empty>
      )}
    </div>
  )
}

export function RightPanel({ sessionId, onClose }: { sessionId: string; onClose?: () => void }) {
  const tab = useSettings((s) => s.ui.rightTab)
  const setUi = useSettings((s) => s.setUi)
  const netCount = useNetlog((s) => s.entries.length)
  const hasPreview = useUi((s) => s.preview?.sessionId === sessionId)
  const todos = useSessions((s) => s.sessions.find((x) => x.id === sessionId)?.todos.length ?? 0)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.07] p-2">
        <Tabs<RightTab>
          className="min-w-0 flex-1"
          value={tab}
          onChange={(t) => setUi({ rightTab: t })}
          items={[
            { id: 'files', label: 'Archivos', icon: <FolderTree size={13} /> },
            { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={13} /> },
            { id: 'tasks', label: 'Tareas', icon: <ListTodo size={13} />, badge: todos ? <span className="text-faint">{todos}</span> : null },
            { id: 'network', label: 'Red', icon: <ArrowUpRight size={13} />, badge: netCount ? <span className="text-faint">{netCount}</span> : null },
            { id: 'preview', label: 'Preview', icon: <Eye size={13} />, badge: hasPreview ? <span className="size-1.5 rounded-full bg-cyan" /> : null },
          ]}
        />
        {onClose && (
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar panel">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'files' && <FilesPanel sessionId={sessionId} />}
        {tab === 'terminal' && <TerminalPanel sessionId={sessionId} />}
        {tab === 'tasks' && <TasksPanel sessionId={sessionId} />}
        {tab === 'network' && <NetworkPanel />}
        {tab === 'preview' && <PreviewPanel sessionId={sessionId} />}
      </div>
    </div>
  )
}
