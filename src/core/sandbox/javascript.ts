// Ejecuta JavaScript en un worker sin red. Cada ejecución usa un worker nuevo
// (aislamiento total entre ejecuciones y timeout duro con terminate()).

import type { Workspace } from './workspace'

export interface JsRunOutput {
  stdout: string
  stderr: string
  ok: boolean
  result?: string
  error?: string
  timedOut?: boolean
}

export interface JsBridge {
  /** Si se define, el código puede usar host.fetch() (con permiso y guard del host). */
  fetch?: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
    status: number
    headers: Record<string, string>
    body: string
  }>
}

export interface JsOptions {
  timeoutMs?: number
  args?: unknown
  argv?: string[]
  signal?: AbortSignal
  bridge?: JsBridge
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
}

export function runJavaScript(ws: Workspace, code: string, opts: JsOptions = {}): Promise<JsRunOutput> {
  const worker = new Worker('/sandbox/js-worker.js', { name: 'glasshouse-js' })
  const timeoutMs = opts.timeoutMs ?? 30_000
  const id = 1
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (out: Omit<JsRunOutput, 'stdout' | 'stderr'>) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker.terminate()
      resolve({ stdout, stderr, ...out })
    }
    const timer = setTimeout(() => finish({ ok: false, timedOut: true, error: `Tiempo agotado (${Math.round(timeoutMs / 1000)} s)` }), timeoutMs)
    opts.signal?.addEventListener('abort', () => finish({ ok: false, error: 'Ejecución cancelada' }), { once: true })

    worker.onerror = (e) => finish({ ok: false, error: e.message || 'Error en el worker' })
    worker.onmessage = async (ev) => {
      const msg = ev.data
      if (msg.type === 'stdout' || msg.type === 'stderr') {
        if (msg.type === 'stdout') stdout += msg.text
        else stderr += msg.text
        opts.onOutput?.(msg.type, msg.text)
      } else if (msg.type === 'done') {
        finish({ ok: msg.ok, result: msg.result, error: msg.error })
      } else if (msg.type === 'rpc') {
        let result: unknown
        let error: string | undefined
        try {
          result = await handleRpc(ws, msg.method, msg.params, opts.bridge)
        } catch (e) {
          error = (e as Error).message
        }
        if (!done) worker.postMessage({ type: 'rpc_result', callId: msg.callId, result, error })
      }
    }
    worker.postMessage({ type: 'run', id, code, args: opts.args, argv: opts.argv })
  })
}

async function handleRpc(ws: Workspace, method: string, params: Record<string, unknown>, bridge?: JsBridge): Promise<unknown> {
  const path = String(params.path ?? '.')
  switch (method) {
    case 'fs.readFile':
      return ws.readText(path)
    case 'fs.writeFile':
      await ws.writeFile(path, String(params.content ?? ''))
      return true
    case 'fs.list':
      return (await ws.list(path)).map((f) => ({ name: f.name, path: f.path, isDir: f.isDir, size: f.size }))
    case 'fs.exists':
      return ws.exists(path)
    case 'fs.remove':
      await ws.remove(path)
      return true
    case 'bash.exec': {
      const r = await ws.exec(String(params.command ?? ''))
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
    }
    case 'net.fetch':
      if (!bridge?.fetch) throw new Error('Este código no tiene permiso de red (host.fetch desactivado).')
      return bridge.fetch(String(params.url), (params.init ?? {}) as Record<string, never>)
    default:
      throw new Error(`Método RPC desconocido: ${method}`)
  }
}
