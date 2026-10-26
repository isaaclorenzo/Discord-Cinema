// Interacciones pendientes que bloquean el bucle de agente: permisos,
// preguntas (AskUserQuestion) y aprobación de planes (ExitPlanMode).

import { ClipboardList, Globe, MessageSquare, ShieldQuestion, SquareTerminal, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Question } from '../../core/tools/types'
import { useUi, type Interaction } from '../../state/ui'
import { cx } from '../cx'
import { Markdown } from './Markdown'

function PermissionCard({ it }: { it: Extract<Interaction, { kind: 'permission' }> }) {
  const { req } = it
  const [denyMsg, setDenyMsg] = useState('')
  const [showDeny, setShowDeny] = useState(false)
  const network = req.tool.permission === 'network'
  const detail =
    req.tool.name === 'Bash'
      ? String(req.input.command ?? '')
      : req.tool.name === 'Write' || req.tool.name === 'Edit' || req.tool.name === 'MultiEdit'
        ? String(req.input.file_path ?? '')
        : JSON.stringify(req.input, null, 2)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === '1') it.resolve({ decision: 'allow' })
      else if (e.key === '2') it.resolve({ decision: 'allow_always', rule: req.suggestedRule })
      else if (e.key === '3') setShowDeny(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [it, req.suggestedRule])

  return (
    <div className={cx('glass-strong rounded-2xl p-4 animate-fade-in', network && 'border-amber-300/30')}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {network ? <Globe size={16} className="text-amber" /> : req.tool.name === 'Bash' ? <SquareTerminal size={16} className="text-sky-200" /> : <Wrench size={16} className="text-sky-200" />}
        {network ? 'El modelo quiere usar la red' : 'Permiso para usar una herramienta'}
        <span className="chip">{req.tool.name}</span>
        {req.label && <span className="chip">{req.label}</span>}
      </div>
      {network && (
        <p className="mt-1 text-xs text-amber-100/70">
          Esto sale de tu navegador. Revisa que la petición no lleve datos de tu workspace ni de la conversación.
        </p>
      )}
      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/35 p-3 font-mono text-xs">{detail}</pre>
      {showDeny ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="input" placeholder="Dile al modelo qué hacer en su lugar (opcional)" value={denyMsg} onChange={(e) => setDenyMsg(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && it.resolve({ decision: 'deny', message: denyMsg || undefined })} />
          <button className="btn btn-danger" onClick={() => it.resolve({ decision: 'deny', message: denyMsg || undefined })}>
            Denegar
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => it.resolve({ decision: 'allow' })}>
            <span className="kbd">1</span> Permitir
          </button>
          <button className="btn" onClick={() => it.resolve({ decision: 'allow_always', rule: req.suggestedRule })} title={`Añade la regla ${req.suggestedRule}`}>
            <span className="kbd">2</span> Permitir siempre <span className="font-mono text-[11px] text-muted">{req.suggestedRule}</span>
          </button>
          <button className="btn btn-danger" onClick={() => setShowDeny(true)}>
            <span className="kbd">3</span> Denegar
          </button>
        </div>
      )}
    </div>
  )
}

function QuestionBlock({ q, value, onChange }: { q: Question; value: string[]; onChange: (v: string[]) => void }) {
  const [other, setOther] = useState('')
  const toggle = (label: string) => {
    if (q.multiSelect) onChange(value.includes(label) ? value.filter((v) => v !== label) : [...value, label])
    else onChange([label])
  }
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm">
        {q.header && <span className="chip mr-2">{q.header}</span>}
        {q.question}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => toggle(o.label)}
            className={cx('rounded-xl border px-3 py-2 text-left transition', value.includes(o.label) ? 'border-sky-300/50 bg-sky-500/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]')}
          >
            <div className="text-[13px] font-medium">{o.label}</div>
            {o.description && <div className="text-xs text-muted">{o.description}</div>}
          </button>
        ))}
      </div>
      <input
        className="input"
        placeholder="Otra respuesta…"
        value={other}
        onChange={(e) => {
          setOther(e.target.value)
          onChange(e.target.value ? [e.target.value] : [])
        }}
      />
    </fieldset>
  )
}

function QuestionsCard({ it }: { it: Extract<Interaction, { kind: 'questions' }> }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const done = it.questions.every((q) => answers[q.question]?.length)
  return (
    <div className="glass-strong space-y-4 rounded-2xl p-4 animate-fade-in">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageSquare size={16} className="text-cyan" /> El modelo te pregunta
      </div>
      {it.questions.map((q) => (
        <QuestionBlock key={q.question} q={q} value={answers[q.question] ?? []} onChange={(v) => setAnswers((a) => ({ ...a, [q.question]: v }))} />
      ))}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={() => it.resolve(Object.fromEntries(it.questions.map((q) => [q.question, '(el usuario no respondió)'])))}>
          Omitir
        </button>
        <button className="btn btn-primary" disabled={!done} onClick={() => it.resolve(Object.fromEntries(it.questions.map((q) => [q.question, (answers[q.question] ?? []).join(', ')])))}>
          Responder
        </button>
      </div>
    </div>
  )
}

function PlanCard({ it }: { it: Extract<Interaction, { kind: 'plan' }> }) {
  const [feedback, setFeedback] = useState('')
  return (
    <div className="glass-strong rounded-2xl p-4 animate-fade-in">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ClipboardList size={16} className="text-sky-200" /> Plan propuesto
      </div>
      <div className="glass-inset mt-3 max-h-80 overflow-y-auto rounded-xl p-4">
        <Markdown text={it.plan} />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input className="input" placeholder="Cambios que quieres en el plan (opcional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn" onClick={() => it.resolve({ approved: false, feedback: feedback || undefined })}>
            Seguir planificando
          </button>
          <button className="btn btn-primary" onClick={() => it.resolve({ approved: true })}>
            Aprobar
          </button>
        </div>
      </div>
    </div>
  )
}

export function Interactions({ sessionId }: { sessionId: string }) {
  const all = useUi((s) => s.interactions)
  const items = all.filter((i) => i.sessionId === sessionId)
  const first = items[0]
  if (!first) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      {items.length > 1 && (
        <div className="mb-1 flex items-center gap-1 text-[11px] text-muted">
          <ShieldQuestion size={12} /> {items.length} solicitudes pendientes
        </div>
      )}
      {first.kind === 'permission' ? <PermissionCard key={first.id} it={first} /> : first.kind === 'questions' ? <QuestionsCard key={first.id} it={first} /> : <PlanCard key={first.id} it={first} />}
    </div>
  )
}
