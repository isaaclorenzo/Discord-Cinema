// Ejecuta Python en el worker de Pyodide, sincronizando /workspace.

import { HOME, type Workspace } from './workspace'
import { assetUrl, sandboxReady } from './host'

export interface RunOutput {
  stdout: string
  stderr: string
  ok: boolean
  result?: string
  error?: string
  timedOut?: boolean
  changedFiles: string[]
}

interface RunMsg {
  type: 'run'
  id: number
  code: string
  files: Array<[string, Uint8Array]>
  cwd: string
  argv: string[]
  stdin?: string
  allowPackages: boolean
  sessionKey: string
}

const MAX_SYNC_BYTES = 64 * 1024 * 1024

export interface PythonOptions {
  timeoutMs?: number
  argv?: string[]
  stdin?: string
  cwd?: string
  signal?: AbortSignal
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
}

type Listener = (msg: { type: string; id?: number; text?: string } & Record<string, unknown>) => void

class PythonRunner {
  private worker: Worker | null = null
  private seq = 0
  private listeners = new Set<Listener>()
  private queue: Promise<unknown> = Promise.resolve()
  status = ''
  allowPackages = false
  private statusListeners = new Set<(s: string) => void>()

  onStatus(fn: (s: string) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(assetUrl('sandbox/py-worker.js'), { type: 'module', name: 'isc-agent-python' })
    w.onmessage = (ev) => {
      const msg = ev.data
      if (msg?.type === 'status') {
        this.status = msg.text ?? ''
        for (const fn of this.statusListeners) fn(this.status)
        return
      }
      for (const l of this.listeners) l(msg)
    }
    this.worker = w
    return w
  }

  warmup(): void {
    this.ensure().postMessage({ type: 'warmup' })
  }

  reset(): void {
    this.worker?.terminate()
    this.worker = null
    this.status = ''
    for (const fn of this.statusListeners) fn('')
  }

  /** Las ejecuciones se serializan: un único intérprete compartido. */
  run(ws: Workspace, code: string, opts: PythonOptions = {}): Promise<RunOutput> {
    const next = this.queue.then(() => this.runNow(ws, code, opts))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async runNow(ws: Workspace, code: string, opts: PythonOptions): Promise<RunOutput> {
    const files: Array<[string, Uint8Array]> = []
    let total = 0
    for (const f of await ws.walk(HOME)) {
      if (total + f.size > MAX_SYNC_BYTES) break
      total += f.size
      files.push([f.path, await ws.readBytes(f.path)])
    }
    const id = ++this.seq
    await sandboxReady()
    const worker = this.ensure()
    const timeoutMs = opts.timeoutMs ?? 120_000

    return new Promise<RunOutput>((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (out: Omit<RunOutput, 'stdout' | 'stderr'>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve({ stdout, stderr, ...out })
      }
      const kill = (reason: string) => {
        this.reset()
        stderr += `\n[ISC AGENT] ${reason}. El intérprete se ha reiniciado.\n`
        finish({ ok: false, timedOut: true, error: reason, changedFiles: [] })
      }
      const timer = setTimeout(() => kill(`Tiempo agotado (${Math.round(timeoutMs / 1000)} s)`), timeoutMs)
      opts.signal?.addEventListener('abort', () => kill('Ejecución cancelada'), { once: true })

      const listener: Listener = async (msg) => {
        if (msg.id !== id) return
        if (msg.type === 'stdout' || msg.type === 'stderr') {
          const text = String(msg.text ?? '')
          if (msg.type === 'stdout') stdout += text
          else stderr += text
          opts.onOutput?.(msg.type, text)
          return
        }
        if (msg.type === 'done') {
          const changed = (msg.files as Array<[string, Uint8Array]>) ?? []
          const deleted = (msg.deleted as string[]) ?? []
          for (const [path, data] of changed) await ws.writeFile(path, data, { silent: true })
          for (const path of deleted) await ws.fs.rm(path, { force: true })
          if (changed.length || deleted.length) ws.touch()
          finish({
            ok: Boolean(msg.ok),
            result: (msg.result as string) ?? undefined,
            error: (msg.error as string) ?? undefined,
            changedFiles: [...changed.map(([p]) => p), ...deleted],
          })
        }
      }
      this.listeners.add(listener)
      const payload: RunMsg = {
        type: 'run',
        id,
        code,
        files,
        cwd: opts.cwd ?? ws.cwd,
        argv: opts.argv ?? [],
        stdin: opts.stdin,
        allowPackages: this.allowPackages,
        sessionKey: ws.id,
      }
      worker.postMessage(payload)
    })
  }
}

export const python = new PythonRunner()
