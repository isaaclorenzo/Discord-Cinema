// Monta /api/relay en el servidor de desarrollo y en `vite preview`, usando el
// mismo handler que la función de Vercel.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { loadEnv } from 'vite'
import { handleRelay } from '../api/relay'

function toRequest(req: IncomingMessage, body: Buffer | undefined, signal: AbortSignal): Request {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  }
  return new Request(`http://localhost${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: body && body.length > 0 ? new Uint8Array(body) : undefined,
    signal,
  })
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function middleware(env: Record<string, string>): Connect.NextHandleFunction {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    try {
      const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : await readBody(req)
      const response = await handleRelay(toRequest(req, body, controller.signal), {
        env: { ...env, ...process.env },
        dev: true,
      })
      res.statusCode = response.status
      response.headers.forEach((v, k) => res.setHeader(k, v))
      if (!response.body) return res.end()
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
    } catch (err) {
      if (!res.headersSent) res.statusCode = 502
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
  }
}

export function relayDevPlugin(): Plugin {
  let env: Record<string, string> = {}
  return {
    name: 'glasshouse-relay',
    configResolved(config) {
      env = loadEnv(config.mode, config.root, '')
    },
    configureServer(server) {
      server.middlewares.use('/api/relay', middleware(env))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/relay', middleware(env))
    },
  }
}
