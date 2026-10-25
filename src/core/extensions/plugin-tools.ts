// Herramientas definidas por plugins: esquema JSON + código JS que corre en el
// worker sin red. Si el plugin declara network, host.fetch() pasa por el host
// (permiso del usuario, guard e inspector).

import { runJavaScript } from '../sandbox/javascript'
import type { AnyTool } from '../tools/types'
import { truncate } from '../util'
import type { PluginToolDef } from './types'

export function pluginToolToDef(t: PluginToolDef): AnyTool {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    readOnly: !!t.readOnly && !t.network,
    permission: t.network ? 'network' : t.readOnly ? 'none' : 'exec',
    source: t.source,
    summarize: (i: Record<string, unknown>) => truncate(JSON.stringify(i), 80),
    async run(input: Record<string, unknown>, ctx) {
      const r = await runJavaScript(ctx.ws, t.code, {
        args: input,
        timeoutMs: 60_000,
        signal: ctx.signal,
        bridge: t.network && ctx.agent.pluginFetch ? { fetch: ctx.agent.pluginFetch } : undefined,
      })
      const parts = [r.result !== undefined ? r.result : '', r.stdout.trim(), r.stderr.trim(), r.error ?? ''].filter(Boolean)
      return { content: truncate(parts.join('\n'), 50_000) || '(no output)', isError: !r.ok }
    },
  }
}
