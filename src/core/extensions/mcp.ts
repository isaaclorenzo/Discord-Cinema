// Cliente MCP (Streamable HTTP, con SSE como alternativa). Las peticiones
// pasan por netFetch: guard, inspector y relay opcional. Cada herramienta
// remota se expone como mcp__<servidor>__<tool> y pide permiso de red.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { makeSdkFetch } from '../net'
import type { AnyTool, ToolResult } from '../tools/types'
import type { ImagePart, JsonSchema } from '../types'
import { truncate } from '../util'
import type { McpServerDef } from './types'

interface Conn {
  client: Client
  tools: Array<{ name: string; description?: string; inputSchema: JsonSchema; readOnly?: boolean }>
  key: string
}

const conns = new Map<string, Promise<Conn>>()
export const mcpStatus = new Map<string, { ok: boolean; error?: string; tools: number }>()

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
}

function keyOf(s: McpServerDef, secret: string): string {
  return JSON.stringify([s.url, s.transport, s.connection, s.headers, secret])
}

async function connect(s: McpServerDef, secret: string): Promise<Conn> {
  const fetchFn = makeSdkFetch({ purpose: 'mcp', label: `MCP · ${s.name}`, via: s.connection })
  const headers: Record<string, string> = { ...(s.headers ?? {}) }
  if (secret) headers.authorization = secret.startsWith('Bearer ') ? secret : `Bearer ${secret}`
  const url = new URL(s.url)
  const client = new Client({ name: 'glasshouse', version: '0.1.0' })
  if (s.transport === 'sse') {
    await client.connect(new SSEClientTransport(url, { fetch: fetchFn, requestInit: { headers } }))
  } else {
    await client.connect(new StreamableHTTPClientTransport(url, { fetch: fetchFn, requestInit: { headers } }))
  }
  const listed = await client.listTools()
  return {
    client,
    key: keyOf(s, secret),
    tools: listed.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema ?? { type: 'object' }) as JsonSchema,
      readOnly: t.annotations?.readOnlyHint === true,
    })),
  }
}

async function getConn(s: McpServerDef, secret: string): Promise<Conn> {
  const existing = conns.get(s.id)
  if (existing) {
    const c = await existing.catch(() => null)
    if (c && c.key === keyOf(s, secret)) return c
    conns.delete(s.id)
  }
  const p = connect(s, secret)
  conns.set(s.id, p)
  p.then(
    (c) => mcpStatus.set(s.id, { ok: true, tools: c.tools.length }),
    (e) => {
      conns.delete(s.id)
      mcpStatus.set(s.id, { ok: false, error: (e as Error).message, tools: 0 })
    },
  )
  return p
}

export async function testMcpServer(s: McpServerDef, secret: string): Promise<{ ok: boolean; tools: string[]; error?: string }> {
  conns.delete(s.id)
  try {
    const c = await getConn(s, secret)
    return { ok: true, tools: c.tools.map((t) => t.name) }
  } catch (e) {
    return { ok: false, tools: [], error: (e as Error).message }
  }
}

function contentToResult(content: Array<Record<string, unknown>>, isError: boolean): ToolResult {
  const texts: string[] = []
  const images: ImagePart[] = []
  for (const c of content ?? []) {
    if (c.type === 'text') texts.push(String(c.text ?? ''))
    else if (c.type === 'image' && typeof c.data === 'string') images.push({ mediaType: String(c.mimeType ?? 'image/png'), data: c.data })
    else if (c.type === 'resource') texts.push(JSON.stringify(c.resource))
    else texts.push(JSON.stringify(c))
  }
  return {
    content: `<untrusted_content source="mcp">\n${truncate(texts.join('\n'), 100_000) || '(empty)'}\n</untrusted_content>`,
    images: images.length ? images : undefined,
    isError,
  }
}

/** Conecta a los servidores activos y devuelve sus herramientas como ToolDef. */
export async function loadMcpTools(servers: McpServerDef[], getSecret: (id: string) => string): Promise<AnyTool[]> {
  const out: AnyTool[] = []
  await Promise.all(
    servers.map(async (s) => {
      let conn: Conn
      try {
        conn = await getConn(s, getSecret(`mcp:${s.id}`))
      } catch {
        return
      }
      for (const t of conn.tools) {
        const name = `mcp__${safeName(s.name)}__${safeName(t.name)}`
        out.push({
          name,
          description: `[MCP server "${s.name}"] ${t.description ?? t.name}`,
          inputSchema: t.inputSchema.type ? t.inputSchema : { type: 'object', ...t.inputSchema },
          readOnly: !!t.readOnly,
          permission: 'network',
          source: `mcp:${s.name}`,
          summarize: (i: Record<string, unknown>) => truncate(JSON.stringify(i), 80),
          matchKey: () => undefined,
          async run(input: Record<string, unknown>, ctx) {
            const res = await conn.client.callTool({ name: t.name, arguments: input }, undefined, { signal: ctx.signal })
            return contentToResult((res.content as Array<Record<string, unknown>>) ?? [], Boolean(res.isError))
          },
        })
      }
    }),
  )
  return out
}
