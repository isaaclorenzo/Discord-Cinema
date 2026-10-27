import { Brain, Check, ChevronRight, Copy, Info, Layers, Pencil, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { editAndResend, regenerate, retryAfterGuard } from '../../app/runtime'
import { maskValue } from '../../core/security/guard'
import type { ChatMessage } from '../../core/types'
import { formatUsd } from '../../core/util'
import { useSessions } from '../../state/sessions'
import { useUi } from '../../state/ui'
import { explainProviderError } from '../../core/providers/errors'
import { describeKeyMismatch, keyMismatch } from '../../core/providers/keys'
import { useSecrets } from '../../state/secrets'
import { resolveModel } from '../../state/settings'
import { Spinner } from '../primitives'
import { cx } from '../cx'
import { Markdown } from './Markdown'
import { ToolCard } from './ToolCard'

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2">
      <button className="flex items-center gap-1.5 text-xs text-muted hover:text-fg" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={12} className={cx('transition', open && 'rotate-90')} />
        <Brain size={13} className={cx(live && 'animate-pulse-soft text-sky-300')} />
        {live ? 'Razonando…' : 'Razonamiento'}
        <span className="text-faint">· {text.length.toLocaleString('es')} car.</span>
      </button>
      {open && <div className="mt-2 whitespace-pre-wrap border-l-2 border-sky-300/30 pl-3 text-[13px] leading-relaxed text-muted animate-fade-in">{text}</div>}
    </div>
  )
}

function MetaLine({ m }: { m: ChatMessage }) {
  const meta = m.meta
  if (!meta?.usage && !meta?.durationMs) return null
  const parts: string[] = []
  if (meta.usage) parts.push(`${meta.usage.inputTokens.toLocaleString('es')} → ${meta.usage.outputTokens.toLocaleString('es')} tok`)
  if (meta.ttftMs !== undefined) parts.push(`TTFT ${(meta.ttftMs / 1000).toFixed(2)} s`)
  if (meta.durationMs) parts.push(`${(meta.durationMs / 1000).toFixed(1)} s`)
  if (meta.usage && meta.durationMs) parts.push(`${Math.round((meta.usage.outputTokens / meta.durationMs) * 1000)} tok/s`)
  if (meta.costUsd) parts.push(formatUsd(meta.costUsd))
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
      <span>{meta.model}</span>
      {parts.map((p) => (
        <span key={p}>· {p}</span>
      ))}
      {meta.servedBy && <span className="chip border-amber-300/30 text-amber">servido por {meta.servedBy}</span>}
      {meta.redactions ? (
        <span className="chip border-amber-300/30 text-amber">
          <ShieldAlert size={11} /> {meta.redactions} redacciones
        </span>
      ) : null}
      {meta.stopReason === 'refusal' && <span className="chip border-rose-300/30 text-rose-200">rechazo del modelo</span>}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn btn-ghost btn-icon text-faint hover:text-fg"
      aria-label="Copiar"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

/** ¿La clave del proveedor de esta conversación es de otro proveedor? */
function useKeyMismatch(sessionId: string): string | null {
  const modelRef = useSessions((s) => s.sessions.find((x) => x.id === sessionId)?.modelRef ?? '')
  const resolved = modelRef ? resolveModel(modelRef) : null
  const key = useSecrets((s) => (resolved ? (s.keys[resolved.provider.id] ?? '') : ''))
  const mismatch = resolved && key ? keyMismatch(key, resolved.provider.baseUrl) : null
  return mismatch ? describeKeyMismatch(mismatch) : null
}

function ErrorCard({ m, sessionId, isLast }: { m: ChatMessage; sessionId: string; isLast: boolean }) {
  const err = m.error!
  const mismatch = useKeyMismatch(sessionId)
  if (err.kind === 'abort') return <div className="text-xs text-faint">— {err.message}</div>
  if (err.kind === 'guard') {
    const unique = [...new Map((err.findings ?? []).map((f) => [`${f.label}:${f.value}`, f])).values()]
    return (
      <div className="rounded-2xl border border-amber-300/30 bg-amber-300/[0.06] p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
          <ShieldAlert size={16} /> El escudo de privacidad detuvo el envío
        </div>
        <p className="mt-1 text-xs text-amber-100/70">{err.message} Nada salió del navegador.</p>
        <ul className="mt-3 space-y-1">
          {unique.slice(0, 12).map((f, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="chip">{f.label}</span>
              <code className="font-mono text-amber-50/80">{maskValue(f.value)}</code>
              <span className="text-faint">en {f.where}</span>
            </li>
          ))}
        </ul>
        {isLast && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => retryAfterGuard(sessionId, 'redact')}>
              Redactar y enviar
            </button>
            <button className="btn btn-danger" onClick={() => retryAfterGuard(sessionId, 'allow')}>
              Enviar sin redactar
            </button>
          </div>
        )}
      </div>
    )
  }
  const hint = explainProviderError(err.message)
  return (
    <div className="rounded-2xl border border-rose-300/25 bg-rose-400/[0.06] p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-rose-100">
        <TriangleAlert size={16} /> {hint.title}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-rose-50/90">{hint.hint}</p>
      {mismatch && <p className="mt-2 rounded-xl border border-amber-300/30 bg-amber-300/[0.07] px-3 py-2 text-[13px] leading-relaxed text-amber-100">{mismatch}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-rose-100/60">Detalle técnico</summary>
        <p className="mt-1 break-words font-mono text-xs text-rose-100/80">{err.message}</p>
      </details>
      {isLast && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => regenerate(sessionId)}>
            <RotateCcw size={13} /> Reintentar
          </button>
          {hint.accountIssue && (
            <button className="btn" onClick={() => useUi.getState().setView('providers')}>
              Abrir Proveedores
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function UserBubble({ m, sessionId, canEdit }: { m: ChatMessage; sessionId: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  if (editing) {
    return (
      <div className="ml-auto w-full max-w-2xl">
        <textarea className="input min-h-28 font-sans" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(false)
              void editAndResend(sessionId, m.id, draft)
            }}
          >
            Reenviar
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="group ml-auto flex max-w-[min(42rem,92%)] flex-col items-end gap-1">
      {m.images?.length ? (
        <div className="flex flex-wrap justify-end gap-2">
          {m.images.map((img, i) => (
            <img key={i} src={`data:${img.mediaType};base64,${img.data}`} alt="" className="size-20 rounded-xl border border-white/10 object-cover" />
          ))}
        </div>
      ) : null}
      <div className="rounded-3xl rounded-br-lg border border-sky-300/20 bg-[#1d8cf0]/[0.18] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-[0_12px_30px_-18px_rgba(29,140,240,0.9)]">
        {m.meta?.expandedFrom ? <span className="chip mb-1.5 border-sky-300/30 text-sky-100">{m.meta.expandedFrom.split(' ')[0]}</span> : null}
        {m.meta?.expandedFrom ? <div className="line-clamp-4 text-fg/90">{m.content}</div> : m.content}
      </div>
      {canEdit && (
        <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
          <CopyButton text={m.content} />
          <button className="btn btn-ghost btn-icon text-faint hover:text-fg" aria-label="Editar y reenviar" onClick={() => setEditing(true)}>
            <Pencil size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function SyntheticNote({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false)
  if (m.meta?.isCompactSummary) {
    return (
      <div className="my-2">
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-white/10" />
          <button className="flex items-center gap-1.5 hover:text-fg" onClick={() => setOpen(!open)}>
            <Layers size={13} /> Conversación compactada {open ? '▴' : '▾'}
          </button>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        {open && (
          <div className="glass-inset mt-2 rounded-2xl p-4">
            <Markdown text={m.content} />
          </div>
        )}
      </div>
    )
  }
  return (
    <button className="mx-auto flex max-w-full items-center gap-1.5 text-[11px] text-faint hover:text-muted" onClick={() => setOpen(!open)}>
      <Info size={11} /> contexto añadido automáticamente
      {open && <span className="ml-2 max-w-lg truncate font-mono">{m.content}</span>}
    </button>
  )
}

interface ItemProps {
  m: ChatMessage
  results: Array<ChatMessage | undefined>
  sessionId: string
  isLastAssistant: boolean
  isLast: boolean
  running: boolean
}

function sameItem(a: ItemProps, b: ItemProps): boolean {
  return (
    a.m === b.m &&
    a.sessionId === b.sessionId &&
    a.isLastAssistant === b.isLastAssistant &&
    a.isLast === b.isLast &&
    a.running === b.running &&
    a.results.length === b.results.length &&
    a.results.every((r, i) => r === b.results[i])
  )
}

const Item = memo(function Item({ m, results, sessionId, isLastAssistant, isLast, running }: ItemProps) {
  if (m.role === 'tool') return null
  if (m.role === 'user') {
    if (m.synthetic) return <SyntheticNote m={m} />
    return <UserBubble m={m} sessionId={sessionId} canEdit={!running} />
  }
  if (m.error) return <ErrorCard m={m} sessionId={sessionId} isLast={isLast} />
  if (m.local) {
    return (
      <div className="glass rounded-2xl p-4">
        <Markdown text={m.content} />
      </div>
    )
  }
  const live = running && isLastAssistant
  const empty = !m.content && !m.reasoning && !m.toolCalls?.length
  return (
    <div className={cx('group flex gap-3', m.archived && 'opacity-45')}>
      <span className={cx('orb orb-sm mt-0.5 size-7 shrink-0', live && 'animate-pulse-soft')} aria-hidden />
      <div className="min-w-0 flex-1">
        {m.reasoning && <Reasoning text={m.reasoning} live={live && !m.content && !m.toolCalls?.length} />}
        {empty && live && (
          <div className="flex items-center gap-2 py-1 text-sm text-muted">
            <Spinner /> Pensando…
          </div>
        )}
        {m.content && <Markdown text={m.content} />}
        {m.toolCalls?.length ? (
          <div className="mt-2 space-y-2">
            {m.toolCalls.map((c, i) => (
              <ToolCard key={c.id} call={c} result={results[i]} />
            ))}
          </div>
        ) : null}
        <MetaLine m={m} />
        {!live && m.content && (
          <div className="mt-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
            <CopyButton text={m.content} />
            {isLastAssistant && (
              <button className="btn btn-ghost btn-icon text-faint hover:text-fg" aria-label="Regenerar" onClick={() => regenerate(sessionId)}>
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}, sameItem)

const NO_RESULTS: Array<ChatMessage | undefined> = []

export function MessageList({ sessionId }: { sessionId: string }) {
  const messages = useSessions((s) => s.messages[sessionId])
  const running = useSessions((s) => !!s.running[sessionId])
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const results = useMemo(() => {
    const map = new Map<string, ChatMessage>()
    for (const m of messages ?? []) if (m.role === 'tool' && m.toolCallId) map.set(m.toolCallId, m)
    return map
  }, [messages])

  const visible = (messages ?? []).filter((m) => !(m.archived && m.role === 'assistant' && !m.content && !m.toolCalls?.length))
  const lastAssistantId = [...visible].reverse().find((m) => m.role === 'assistant' && !m.error && !m.local)?.id
  const lastId = visible.at(-1)?.id

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6" aria-live="polite">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 py-6">
        {visible.map((m) => (
          <Item key={m.id} m={m} results={m.toolCalls?.length ? m.toolCalls.map((c) => results.get(c.id)) : NO_RESULTS} sessionId={sessionId} isLastAssistant={m.id === lastAssistantId} isLast={m.id === lastId} running={running} />
        ))}
      </div>
    </div>
  )
}
