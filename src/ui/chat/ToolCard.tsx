import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  Circle,
  CircleDot,
  Code,
  Eye,
  FilePlus,
  FileText,
  Globe,
  ListTodo,
  MessageSquare,
  Pencil,
  Play,
  Puzzle,
  Search,
  ShieldAlert,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ChatMessage, TodoItem, ToolCall, ToolDisplay } from '../../core/types'
import { useSettings } from '../../state/settings'
import { useUi } from '../../state/ui'
import { Spinner } from '../primitives'
import { cx } from '../cx'
import { Markdown } from './Markdown'
import { summarizeInput } from './summarize'

const ICONS: Record<string, ReactNode> = {
  Read: <FileText size={14} />,
  Write: <FilePlus size={14} />,
  Edit: <Pencil size={14} />,
  MultiEdit: <Pencil size={14} />,
  NotebookEdit: <Pencil size={14} />,
  LS: <Search size={14} />,
  Glob: <Search size={14} />,
  Grep: <Search size={14} />,
  Bash: <SquareTerminal size={14} />,
  BashOutput: <SquareTerminal size={14} />,
  KillShell: <SquareTerminal size={14} />,
  Python: <Play size={14} />,
  JavaScript: <Code size={14} />,
  WebFetch: <Globe size={14} />,
  WebSearch: <Globe size={14} />,
  TodoWrite: <ListTodo size={14} />,
  Task: <Bot size={14} />,
  AskUserQuestion: <MessageSquare size={14} />,
  Skill: <Puzzle size={14} />,
  Preview: <Eye size={14} />,
}

function DiffView({ patch }: { patch: string }) {
  const lines = patch.split('\n').filter((l) => !/^(Index:|={5,}|---|\+\+\+)/.test(l))
  return (
    <pre className="max-h-96 overflow-auto rounded-xl bg-black/35 p-3 font-mono text-[11.5px] leading-relaxed">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cx(
            'whitespace-pre-wrap break-all px-1',
            l.startsWith('+') && 'bg-emerald-400/10 text-emerald-200',
            l.startsWith('-') && 'bg-rose-400/10 text-rose-200',
            l.startsWith('@@') && 'text-cyan-300/80',
            l.startsWith('\\') && 'text-faint',
          )}
        >
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}

function Pre({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <pre className={cx('max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/35 p-3 font-mono text-[11.5px] leading-relaxed', tone === 'error' ? 'text-rose-200' : 'text-fg/85')}>
      {children}
    </pre>
  )
}

export function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="space-y-1.5">
      {todos.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px]">
          {t.status === 'completed' ? (
            <CircleCheck size={15} className="mt-0.5 shrink-0 text-ok" />
          ) : t.status === 'in_progress' ? (
            <CircleDot size={15} className="mt-0.5 shrink-0 text-cyan animate-pulse-soft" />
          ) : (
            <Circle size={15} className="mt-0.5 shrink-0 text-faint" />
          )}
          <span className={cx(t.status === 'completed' && 'text-muted line-through decoration-white/20', t.status === 'in_progress' && 'text-fg')}>
            {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
          </span>
        </li>
      ))}
    </ul>
  )
}

function SubagentView({ display }: { display: ToolDisplay }) {
  const messages = (display.messages as ChatMessage[]) ?? []
  const calls = messages.flatMap((m) => m.toolCalls ?? [])
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {calls.slice(-12).map((c) => {
          const res = messages.find((m) => m.role === 'tool' && m.toolCallId === c.id)
          return (
            <span key={c.id} className={cx('chip', res?.isError && 'border-rose-300/30 text-rose-200')}>
              {ICONS[c.name] ?? <Wrench size={12} />}
              {c.name}
              <span className="max-w-40 truncate text-faint">{summarizeInput(c.name, c.input)}</span>
            </span>
          )
        })}
        {calls.length > 12 && <span className="chip">+{calls.length - 12}</span>}
      </div>
      {last && (
        <div className="glass-inset rounded-xl p-3">
          <Markdown text={last.content.length > 4000 ? `${last.content.slice(0, 4000)}…` : last.content} />
        </div>
      )}
    </div>
  )
}

function DisplayBody({ display, result }: { display: ToolDisplay; result?: ChatMessage }) {
  switch (display.kind) {
    case 'diff':
      return <DiffView patch={String(display.patch ?? '')} />
    case 'terminal': {
      const out = `${display.stdout ?? ''}${display.stderr ? `${display.stderr}` : ''}`.replace(/\n$/, '')
      return (
        <Pre tone={Number(display.exitCode) !== 0 && !display.stdout ? 'error' : undefined}>
          <span className="text-cyan-300/80">{String(display.cwd ?? '/workspace')} $ </span>
          {String(display.command ?? '')}
          {'\n'}
          {out || <span className="text-faint">(sin salida)</span>}
          {Number(display.exitCode) !== 0 && <span className="text-rose-300">{`\n[exit ${display.exitCode}]`}</span>}
        </Pre>
      )
    }
    case 'code':
      return (
        <div className="space-y-2">
          <Pre>{String(display.code ?? '')}</Pre>
          {Boolean(display.stdout || display.stderr || display.result) && (
            <Pre tone={display.ok ? undefined : 'error'}>
              {String(display.stdout ?? '')}
              {display.result !== undefined && display.result !== null && <span className="text-sky-200">{`→ ${display.result}\n`}</span>}
              {String(display.stderr ?? '')}
            </Pre>
          )}
        </div>
      )
    case 'todos':
      return <TodoList todos={(display.todos as TodoItem[]) ?? []} />
    case 'subagent':
      return <SubagentView display={display} />
    case 'web':
      if (Array.isArray(display.results)) {
        return (
          <ul className="space-y-2">
            {(display.results as Array<{ title: string; url: string; snippet: string }>).map((r, i) => (
              <li key={i} className="text-[13px]">
                <div className="font-medium text-fg/90">{r.title}</div>
                <div className="truncate font-mono text-[11px] text-cyan-200/70">{r.url}</div>
                <div className="text-xs text-muted">{r.snippet}</div>
              </li>
            ))}
          </ul>
        )
      }
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="chip">HTTP {String(display.status)}</span>
            <span className="truncate font-mono">{String(display.url)}</span>
            <span>{Number(display.chars).toLocaleString('es')} caracteres</span>
          </div>
          <Pre>{String(display.preview ?? '')}</Pre>
        </div>
      )
    case 'questions': {
      const answers = (display.answers as Record<string, string>) ?? {}
      return (
        <ul className="space-y-1 text-[13px]">
          {Object.entries(answers).map(([q, a]) => (
            <li key={q}>
              <span className="text-muted">{q}</span> → <b>{a}</b>
            </li>
          ))}
        </ul>
      )
    }
    case 'plan':
      return (
        <div className="space-y-2">
          <span className={cx('chip', display.approved ? 'text-ok' : 'text-amber')}>{display.approved ? 'Aprobado' : 'No aprobado'}</span>
          <Markdown text={String(display.plan ?? '')} />
        </div>
      )
    case 'preview':
      return (
        <button className="btn" onClick={() => useSettings.getState().setUi({ rightPanel: true, rightTab: 'preview' })}>
          <Eye size={14} /> Ver en Preview
        </button>
      )
    case 'text':
      return (
        <div className="space-y-1">
          {display.title ? <div className="text-xs font-medium text-muted">{String(display.title)}</div> : null}
          <Pre>{String(display.text ?? '')}</Pre>
        </div>
      )
    default:
      return <Pre tone={result?.isError ? 'error' : undefined}>{result?.content}</Pre>
  }
}

const COLLAPSED_BY_DEFAULT = new Set(['Read', 'Glob', 'Grep', 'LS', 'Skill', 'BashOutput', 'WebFetch', 'WebSearch', 'SlashCommand'])

export function ToolCard({ call, result }: { call: ToolCall; result?: ChatMessage }) {
  const status = result?.status ?? (result ? 'done' : 'running')
  const isErr = !!result?.isError
  const hasDisplay = !!result?.display
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? (status === 'running' && hasDisplay ? true : !COLLAPSED_BY_DEFAULT.has(call.name) && (hasDisplay || isErr))
  const summary = summarizeInput(call.name, call.input)
  const openFile = (path: string) => {
    useUi.getState().setOpenFile(path)
    useSettings.getState().setUi({ rightPanel: true, rightTab: 'files' })
  }
  const filePath = typeof call.input.file_path === 'string' ? call.input.file_path : undefined
  const guardBlocked = result?.display?.kind === 'text' && String(result.display.title ?? '').includes('escudo')

  return (
    <div className={cx('glass-inset overflow-hidden rounded-2xl', guardBlocked && 'border-amber-300/30')}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <ChevronRight size={13} className={cx('shrink-0 text-faint transition', expanded && 'rotate-90')} />
        <span className={cx('shrink-0', isErr ? 'text-rose-300' : 'text-sky-200')}>{guardBlocked ? <ShieldAlert size={14} className="text-amber" /> : (ICONS[call.name] ?? <Wrench size={14} />)}</span>
        <span className="shrink-0 text-[13px] font-medium">{call.name.startsWith('mcp__') ? call.name.split('__').slice(1).join(' · ') : call.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{summary}</span>
        {result?.display?.kind === 'diff' && (
          <span className="shrink-0 font-mono text-[11px]">
            <span className="text-emerald-300">+{String(result.display.added)}</span> <span className="text-rose-300">-{String(result.display.removed)}</span>
          </span>
        )}
        <span className="shrink-0">
          {status === 'running' ? (
            <Spinner size={13} />
          ) : status === 'awaiting' ? (
            <span className="chip border-amber-300/30 text-amber">permiso</span>
          ) : status === 'denied' ? (
            <Ban size={14} className="text-amber" />
          ) : isErr ? (
            <X size={14} className="text-rose-300" />
          ) : (
            <Check size={14} className="text-ok" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-white/[0.06] px-3 py-3 animate-fade-in">
          {result?.display ? <DisplayBody display={result.display} result={result} /> : null}
          {result && (!result.display || isErr) && result.content && result.display?.kind !== 'terminal' && <Pre tone={isErr ? 'error' : undefined}>{result.content}</Pre>}
          {!result?.display && !result?.content && (
            <Pre>{JSON.stringify(call.input, null, 2)}</Pre>
          )}
          {filePath && status === 'done' && !isErr && (
            <button className="btn btn-ghost px-2 py-1 text-xs text-muted" onClick={() => openFile(filePath)}>
              <FileText size={12} /> Abrir en el editor
            </button>
          )}
        </div>
      )}
    </div>
  )
}
