import { SquareTerminal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../hooks'
import { Spinner } from '../primitives'
import { cx } from '../cx'

interface Line {
  cwd: string
  command: string
  stdout: string
  stderr: string
  exitCode: number
}

const history = new Map<string, Line[]>()

export function TerminalPanel({ sessionId }: { sessionId: string }) {
  const { ws } = useWorkspace(sessionId)
  const [lines, setLines] = useState<Line[]>(() => history.get(sessionId) ?? [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [hist, setHist] = useState<string[]>([])
  const [hIndex, setHIndex] = useState(-1)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    history.set(sessionId, lines)
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines, sessionId])

  const run = async () => {
    if (!ws || !input.trim() || busy) return
    const command = input
    setInput('')
    setHist((h) => [command, ...h].slice(0, 100))
    setHIndex(-1)
    if (command.trim() === 'clear') {
      setLines([])
      return
    }
    setBusy(true)
    const cwd = ws.cwd
    try {
      const r = await ws.exec(command)
      setLines((l) => [...l, { cwd, command, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }])
    } catch (e) {
      setLines((l) => [...l, { cwd, command, stdout: '', stderr: String((e as Error).message), exitCode: 1 }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col font-mono text-[12px]">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-1.5 font-sans text-[11px] text-muted">
        <SquareTerminal size={13} />
        <span className="flex-1">Mismo sandbox que el agente · sin red · lo que escribas aquí no se envía al modelo</span>
        <button className="btn btn-ghost btn-icon" onClick={() => setLines([])} aria-label="Limpiar">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 leading-relaxed" onClick={() => document.getElementById(`term-${sessionId}`)?.focus()}>
        {lines.length === 0 && <div className="text-faint">Prueba: ls -la, cat archivo, python3 -c "print(1+1)", tree, jq…</div>}
        {lines.map((l, i) => (
          <div key={i} className="mb-1.5">
            <div>
              <span className="text-cyan-300/80">{l.cwd} $</span> {l.command}
            </div>
            {l.stdout && <pre className="whitespace-pre-wrap break-words text-fg/85">{l.stdout.replace(/\n$/, '')}</pre>}
            {l.stderr && <pre className="whitespace-pre-wrap break-words text-rose-300">{l.stderr.replace(/\n$/, '')}</pre>}
          </div>
        ))}
        <div className="flex items-center gap-2" ref={bottom}>
          <span className={cx('shrink-0 text-cyan-300/80')}>{ws?.cwd ?? '/workspace'} $</span>
          <input
            id={`term-${sessionId}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
              else if (e.key === 'ArrowUp') {
                e.preventDefault()
                const n = Math.min(hIndex + 1, hist.length - 1)
                if (hist[n] !== undefined) {
                  setHIndex(n)
                  setInput(hist[n])
                }
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                const n = hIndex - 1
                setHIndex(Math.max(n, -1))
                setInput(n >= 0 ? hist[n] : '')
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-fg focus:outline-none"
            spellCheck={false}
            autoComplete="off"
            aria-label="Comando"
            disabled={!ws}
          />
          {busy && <Spinner size={12} />}
        </div>
      </div>
    </div>
  )
}
