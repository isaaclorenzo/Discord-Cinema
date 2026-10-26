import { ArrowUp, AtSign, FileText, Paperclip, ShieldAlert, ShieldCheck, Slash, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { BUILTIN_COMMANDS } from '../../app/builtin-commands'
import { sendUserMessage, setSessionMode, stopSession } from '../../app/runtime'
import { scanText } from '../../core/security/guard'
import type { ImagePart } from '../../core/types'
import { bytesToBase64, formatUsd } from '../../core/util'
import { enabledCommands } from '../../state/extensions'
import { useSessions } from '../../state/sessions'
import { resolveModel, useSettings } from '../../state/settings'
import { useWebGpu } from '../../core/providers/webllm'
import { useUi } from '../../state/ui'
import { getWorkspace } from '../../state/workspaces'
import { cx } from '../cx'
import { ModelPicker, ToolsMenu } from './Pickers'
import { nextMode } from '../../core/agent/permissions'

interface Suggestion {
  value: string
  label: string
  hint?: string
  kind: 'command' | 'file'
}

const MAX_IMAGE = 5 * 1024 * 1024
const LOCAL_MODEL = 'webllm::Qwen3-1.7B-q4f16_1-MLC'

async function fileToImage(file: File): Promise<ImagePart | null> {
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type) || file.size > MAX_IMAGE) return null
  return { mediaType: file.type === 'image/jpg' ? 'image/jpeg' : file.type, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
}

export function Composer({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<ImagePart[]>([])
  const [mentions, setMentions] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId))
  const running = useSessions((s) => !!s.running[sessionId])
  const globalMode = useSettings((s) => s.mode)
  const guard = useSettings((s) => s.guard)
  const mode = session?.mode ?? globalMode
  const isDemo = session ? resolveModel(session.modelRef)?.provider.kind === 'mock' : false
  const gpu = useWebGpu((s) => s.available)

  const findings = useMemo(() => (text.length > 3 ? scanText(text, guard) : []), [text, guard])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [text])

  useEffect(() => {
    ref.current?.focus()
  }, [sessionId])

  const updateSuggestions = async (value: string, caret: number) => {
    const before = value.slice(0, caret)
    if (/^\/[\w:.-]*$/.test(before)) {
      const q = before.slice(1).toLowerCase()
      const all: Suggestion[] = [
        ...BUILTIN_COMMANDS.map((c) => ({ value: `/${c.name} `, label: `/${c.name}`, hint: c.description, kind: 'command' as const })),
        ...enabledCommands().map((c) => ({ value: `/${c.name} `, label: `/${c.name}`, hint: c.description, kind: 'command' as const })),
      ]
      setSuggestions(all.filter((s) => s.label.slice(1).toLowerCase().includes(q)).slice(0, 8))
      setActive(0)
      return
    }
    const at = before.match(/(?:^|\s)@([\w./-]*)$/)
    if (at) {
      const ws = await getWorkspace(sessionId)
      const files = await ws.walk('/workspace', { maxFiles: 2000 })
      const q = at[1].toLowerCase()
      setSuggestions(
        files
          .map((f) => f.path.replace('/workspace/', ''))
          .filter((p) => p.toLowerCase().includes(q))
          .slice(0, 8)
          .map((p) => ({ value: p, label: p, kind: 'file' as const })),
      )
      setActive(0)
      return
    }
    setSuggestions([])
  }

  const applySuggestion = (s: Suggestion) => {
    const el = ref.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret)
    const after = text.slice(caret)
    let next: string
    if (s.kind === 'command') next = s.value + after.trimStart()
    else {
      next = `${before.replace(/@([\w./-]*)$/, `@${s.value} `)}${after}`
      setMentions((m) => [...m, s.value])
    }
    setText(next)
    setSuggestions([])
    requestAnimationFrame(() => el?.focus())
  }

  const addFiles = async (files: FileList | File[]) => {
    const ws = await getWorkspace(sessionId)
    for (const f of Array.from(files)) {
      const img = await fileToImage(f)
      if (img) {
        setImages((list) => [...list, img])
        continue
      }
      const path = `uploads/${f.name.replace(/[^\w.-]+/g, '_')}`
      await ws.writeFile(path, new Uint8Array(await f.arrayBuffer()))
      setMentions((m) => [...m, path])
      setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${path} `)
      useUi.getState().toast(`Subido a /workspace/${path}`, 'success')
    }
  }

  const send = async () => {
    if (running) return
    const value = text.trim()
    if (!value && images.length === 0) return
    const usedMentions = mentions.filter((m) => value.includes(`@${m}`))
    const inline = [...value.matchAll(/(?:^|\s)@([\w./-]+)/g)].map((m) => m[1])
    setText('')
    setImages([])
    setMentions([])
    setSuggestions([])
    await sendUserMessage(sessionId, value, images, [...usedMentions, ...inline])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        applySuggestion(suggestions[active])
        return
      }
      if (e.key === 'Escape') {
        setSuggestions([])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      setSessionMode(sessionId, nextMode(mode))
    } else if (e.key === 'Escape' && running) {
      stopSession(sessionId)
    }
  }

  const onPaste = async (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length) {
      e.preventDefault()
      await addFiles(files)
    }
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) await addFiles(e.dataTransfer.files)
  }

  const insert = (prefix: '/' | '@') => {
    const next = prefix === '/' ? `/${text.replace(/^\/\S*\s?/, '')}` : `${text}${text && !text.endsWith(' ') ? ' ' : ''}@`
    setText(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      const caret = prefix === '/' ? 1 : next.length
      el.setSelectionRange(caret, caret)
      void updateSuggestions(next, caret)
    })
  }

  const guardLabel = guard.action === 'block' ? 'Escudo activo' : guard.action === 'redact' ? 'Escudo: redacta' : guard.action === 'warn' ? 'Escudo: avisa' : 'Escudo apagado'

  return (
    <div className="px-3 pb-3 pt-2 sm:px-6 sm:pb-5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
      <div className="relative mx-auto max-w-3xl">
        {suggestions.length > 0 && (
          <div className="glass-strong absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-2xl p-1.5 animate-fade-in" role="listbox">
            {suggestions.map((s, i) => (
              <button
                key={s.label}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applySuggestion(s)
                }}
                className={cx('flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[13px]', i === active ? 'bg-white/10' : 'hover:bg-white/6')}
              >
                {s.kind === 'command' ? <Slash size={13} className="text-sky-200" /> : <FileText size={13} className="text-cyan" />}
                <span className="font-mono">{s.label}</span>
                {s.hint && <span className="truncate text-xs text-muted">{s.hint}</span>}
              </button>
            ))}
          </div>
        )}
        <div
          className={cx('glass-strong rounded-[1.75rem] p-1.5 transition', dragging && 'border-sky-300/60 ring-2 ring-sky-400/30')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {/* Franja superior: modelo actual y estado del escudo */}
          <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-1">
            {session && (
              <ModelPicker
                bare
                value={session.modelRef}
                onChange={(ref) => {
                  useSessions.getState().patch(sessionId, { modelRef: ref })
                  useSettings.getState().set({ selected: ref })
                }}
              />
            )}
            {isDemo && (
              <button
                className="shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium text-accent transition hover:bg-white/[0.06]"
                title={gpu === false ? 'Este navegador no tiene WebGPU: añade un proveedor real' : 'Qwen3 1.7B corre gratis en tu GPU dentro del navegador. Se descarga una vez (~2 GB) y tus mensajes no salen del equipo.'}
                onClick={() => {
                  if (gpu === false) return useUi.getState().setView('providers')
                  useSessions.getState().patch(sessionId, { modelRef: LOCAL_MODEL })
                  useSettings.getState().set({ selected: LOCAL_MODEL })
                }}
              >
                <span className="sm:hidden">{gpu === false ? 'Proveedor →' : 'Modelo real →'}</span>
                <span className="hidden sm:inline">{gpu === false ? 'Añadir proveedor →' : 'Usar modelo real gratis →'}</span>
              </button>
            )}
            <span className="ml-auto hidden text-[11px] text-faint sm:inline">{session?.tokens ? `${session.tokens.toLocaleString('es')} tok · ${formatUsd(session.costUsd)}` : ''}</span>
            <button
              className={cx('flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] transition hover:bg-white/[0.06]', guard.action === 'off' ? 'text-amber' : 'text-ok', 'ml-auto sm:ml-0')}
              aria-label={guardLabel}
              onClick={() => useUi.getState().setView('security')}
              title="Escudo de privacidad: revisa lo que sale antes de enviarlo"
            >
              {guard.action === 'off' ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
              <span className="hidden sm:inline">{guardLabel}</span>
            </button>
          </div>

          <div className="rounded-[1.4rem] border border-white/[0.06] bg-black/35 p-1.5">
            {(images.length > 0 || findings.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 px-2 pt-1">
                {images.map((img, i) => (
                  <span key={i} className="relative">
                    <img src={`data:${img.mediaType};base64,${img.data}`} alt="" className="size-14 rounded-xl border border-white/10 object-cover" />
                    <button className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink-700 text-muted hover:text-fg" onClick={() => setImages((l) => l.filter((_, k) => k !== i))} aria-label="Quitar imagen">
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {findings.length > 0 && (
                  <span className="chip border-amber-300/30 text-amber" title={findings.map((f) => f.label).join(', ')}>
                    <ShieldAlert size={12} /> Detectado: {[...new Set(findings.map((f) => f.label))].join(', ')}
                  </span>
                )}
              </div>
            )}
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                void updateSuggestions(e.target.value, e.target.selectionStart)
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              placeholder={running ? 'El agente está trabajando… (Esc para detener)' : 'Pregunta o pide una tarea no sensible…'}
              className="block max-h-[260px] min-h-[3rem] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-fg placeholder:truncate placeholder:text-faint focus:outline-none"
              aria-label="Mensaje"
            />
            <div className="flex items-center gap-1.5 px-1 pb-0.5">
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
              <button className="btn rounded-full px-3 py-1.5 text-xs" onClick={() => fileInput.current?.click()} title="Imágenes para el modelo o archivos al workspace">
                <Paperclip size={13} />
                <span className="hidden sm:inline">Importar archivo</span>
              </button>
              <ToolsMenu mode={mode} onMode={(m) => setSessionMode(sessionId, m)} onInsert={insert} />
              <button className="btn btn-icon ml-auto size-9 rounded-full" aria-label="Mencionar archivo" title="Mencionar un archivo del workspace (@)" onClick={() => insert('@')}>
                <AtSign size={16} />
              </button>
              {running ? (
                <button className="btn btn-danger btn-icon size-10 rounded-full" onClick={() => stopSession(sessionId)} aria-label="Detener">
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button className="btn btn-primary btn-icon size-10 rounded-full" onClick={() => void send()} disabled={!text.trim() && images.length === 0} aria-label="Enviar">
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
