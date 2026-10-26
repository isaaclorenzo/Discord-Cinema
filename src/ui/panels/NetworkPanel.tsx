import { ArrowUpRight, Ban, ChevronRight, ShieldAlert, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNetlog, type NetEntry, type NetPurpose } from '../../core/security/netlog'
import { formatBytes } from '../../core/util'
import { Empty } from '../primitives'
import { cx } from '../cx'

const PURPOSE: Record<NetPurpose, string> = {
  llm: 'Modelo',
  models: 'Modelos',
  webfetch: 'WebFetch',
  websearch: 'Búsqueda',
  mcp: 'MCP',
  plugin: 'Plugin',
  install: 'Instalación',
}

function pretty(body?: string): string {
  if (!body) return ''
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function Entry({ e }: { e: NetEntry }) {
  const [open, setOpen] = useState(false)
  const status = e.blocked ? 'bloqueado' : e.error ? 'error' : e.status ? String(e.status) : '…'
  return (
    <div className="border-b border-white/[0.05]">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]" onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={cx('shrink-0 text-faint transition', open && 'rotate-90')} />
        {e.blocked ? <Ban size={13} className="shrink-0 text-amber" /> : <ArrowUpRight size={13} className="shrink-0 text-sky-200" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px]">{e.label}</span>
          <span className="block truncate font-mono text-[10.5px] text-faint">
            {e.method} {e.url}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-[10.5px]">
          <span className={cx('chip', e.blocked ? 'text-amber' : e.error || (e.status ?? 0) >= 400 ? 'text-rose-200' : 'text-ok')}>{status}</span>
          <span className="text-faint">
            {PURPOSE[e.purpose]} · {e.via === 'relay' ? 'relay' : 'directo'} · {formatBytes(e.requestBytes)}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 animate-fade-in">
          <div className="flex flex-wrap gap-2 text-[11px] text-muted">
            <span>{new Date(e.at).toLocaleTimeString('es')}</span>
            {e.durationMs !== undefined && <span>· {e.durationMs} ms</span>}
            {e.redactions > 0 && (
              <span className="chip text-amber">
                <ShieldAlert size={11} /> {e.redactions} redacciones
              </span>
            )}
          </div>
          {e.error && <p className="font-mono text-[11px] text-rose-200">{e.error}</p>}
          {e.requestBody ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-fg/85">{pretty(e.requestBody)}</pre>
          ) : (
            <p className="text-[11px] text-faint">Sin cuerpo (petición GET).</p>
          )}
        </div>
      )}
    </div>
  )
}

export function NetworkPanel() {
  const entries = useNetlog((s) => s.entries)
  const clear = useNetlog((s) => s.clear)
  const [filter, setFilter] = useState<NetPurpose | 'all'>('all')
  const shown = filter === 'all' ? entries : entries.filter((e) => e.purpose === filter)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-1.5">
        <select className="input max-w-36 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as NetPurpose | 'all')} aria-label="Filtrar">
          <option value="all">Todo ({entries.length})</option>
          {Object.entries(PURPOSE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="flex-1 text-[11px] text-faint">Todo lo que sale del navegador, con el cuerpo exacto enviado.</span>
        <button className="btn btn-ghost btn-icon" onClick={clear} aria-label="Vaciar registro">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <Empty icon={<ArrowUpRight size={22} />} title="Sin tráfico todavía">
            Cada petición a un proveedor, a la web o a un servidor MCP aparecerá aquí para que puedas auditar qué datos recibe.
          </Empty>
        ) : (
          shown.map((e) => <Entry key={e.id} e={e} />)
        )}
      </div>
    </div>
  )
}
