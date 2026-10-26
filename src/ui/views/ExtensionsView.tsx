import { Bot, Download, FileUp, FolderSearch, GitBranch, Hammer, Link2, Pencil, Plug, Plus, Puzzle, Slash, Sparkles, Trash2, TriangleAlert, Webhook, Wrench } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { downloadText } from '../../app/export'
import { ensureSession } from '../../app/runtime'
import { testMcpServer } from '../../core/extensions/mcp'
import { exportBundle, importFromUrl, parseBundleOrManifest, pluginsFromFiles, unzipToFiles } from '../../core/extensions/plugins'
import { parseSkillMd, skillToMarkdown, slugify } from '../../core/extensions/skills'
import type { AgentDef, HookDef, HookEvent, McpServerDef, Plugin, PluginToolDef, Skill, SlashCommand } from '../../core/extensions/types'
import { runJavaScript } from '../../core/sandbox/javascript'
import { safeJsonParse, uid } from '../../core/util'
import { allPlugins, enabledAgents, useExtensions } from '../../state/extensions'
import { BUILTIN_SKILLS } from '../../builtin'
import { BUILTIN_AGENTS } from '../../core/extensions/builtin-agents'
import { useSecrets } from '../../state/secrets'
import { useUi } from '../../state/ui'
import { getWorkspace } from '../../state/workspaces'
import { cx } from '../cx'
import { Empty, Field, Modal, PageHeader, PageShell, Spinner, Tabs, Toggle } from '../primitives'

type Tab = 'skills' | 'plugins' | 'commands' | 'agents' | 'hooks' | 'mcp' | 'tools'

function sourceLabel(src: string): string {
  if (src === 'builtin') return 'De serie'
  if (src === 'user') return 'Tuyo'
  return src.replace('plugin:', 'plugin · ')
}

function isOn(id: string, enabled: boolean, builtinEnabled: Record<string, boolean>): boolean {
  return id.startsWith('builtin:') ? (builtinEnabled[id] ?? enabled) : enabled
}

function Row({ title, subtitle, source, on, onToggle, actions, mono }: { title: ReactNode; subtitle?: ReactNode; source: string; on: boolean; onToggle: (v: boolean) => void; actions?: ReactNode; mono?: boolean }) {
  return (
    <div className={cx('glass-inset flex items-start gap-3 rounded-2xl px-4 py-3', !on && 'opacity-55')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx('text-[13.5px] font-medium', mono && 'font-mono')}>{title}</span>
          <span className="chip">{sourceLabel(source)}</span>
        </div>
        {subtitle && <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <Toggle checked={on} onChange={onToggle} />
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button className={cx('btn btn-ghost btn-icon', danger && 'hover:text-rose-200')} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Editores
// ---------------------------------------------------------------------------

function SkillEditor({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  const [text, setText] = useState(() =>
    skill ? skillToMarkdown(skill) : '---\nname: mi-skill\ndescription: Qué hace y cuándo usarla (esto es lo que ve el modelo).\n---\n\n# Mi skill\n\n1. Paso uno…\n',
  )
  const parsed = parseSkillMd(text, { source: 'user', idPrefix: 'user' })
  const save = () => {
    const s: Skill = { ...parsed, id: skill?.source === 'user' ? skill.id : `user:skill:${parsed.name}`, files: skill?.files ?? {}, enabled: skill?.enabled ?? true }
    useExtensions.getState().upsertSkill(s)
    useUi.getState().toast(`Skill «${s.name}» guardada`, 'success')
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={skill ? `Editar skill · ${skill.name}` : 'Nueva skill'} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <p className="mb-2 text-xs text-muted">Formato SKILL.md de Claude Code: frontmatter con <code>name</code> y <code>description</code>, y debajo las instrucciones.</p>
      <textarea className="input min-h-[22rem] font-mono text-xs leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <p className="mt-2 text-xs text-faint">
        Nombre: <b className="text-fg">{parsed.name}</b> · Descripción: {parsed.description.slice(0, 120)}
      </p>
    </Modal>
  )
}

function CommandEditor({ cmd, onClose }: { cmd: SlashCommand | null; onClose: () => void }) {
  const [c, setC] = useState<SlashCommand>(
    () => cmd ?? { id: '', name: 'mi-comando', description: '', template: 'Haz lo siguiente con $ARGUMENTS:\n1. …', source: 'user', enabled: true },
  )
  const save = () => {
    const name = slugify(c.name)
    useExtensions.getState().upsertCommand({ ...c, name, id: cmd?.id || `user:command:${name}`, source: 'user' })
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={cmd ? `Editar /${cmd.name}` : 'Nuevo comando'} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre (sin /)">
          <input className="input font-mono" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </Field>
        <Field label="Pista de argumentos">
          <input className="input" value={c.argumentHint ?? ''} onChange={(e) => setC({ ...c, argumentHint: e.target.value || undefined })} placeholder="<ruta> [opciones]" />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Descripción">
          <input className="input" value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} />
        </Field>
        <Field label="Plantilla del prompt" hint="Variables: $ARGUMENTS, $1…$9. @ruta incluye un archivo del workspace. !`comando` inserta la salida de un comando del bash del sandbox.">
          <textarea className="input min-h-48 font-mono text-xs" value={c.template} onChange={(e) => setC({ ...c, template: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function AgentEditor({ agent, onClose }: { agent: AgentDef | null; onClose: () => void }) {
  const [a, setA] = useState<AgentDef>(
    () => agent ?? { id: '', name: 'mi-agente', description: 'Qué hace y cuándo delegarle trabajo.', systemPrompt: 'You are a sub-agent that…', tools: undefined, model: 'inherit', source: 'user', enabled: true },
  )
  const [tools, setTools] = useState((agent?.tools ?? []).join(', '))
  const save = () => {
    const name = slugify(a.name)
    const list = tools.split(',').map((t) => t.trim()).filter(Boolean)
    useExtensions.getState().upsertAgent({ ...a, name, tools: list.length ? list : undefined, id: agent?.id || `user:agent:${name}`, source: 'user' })
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={agent ? `Editar agente · ${agent.name}` : 'Nuevo sub-agente'} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre">
          <input className="input font-mono" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
        </Field>
        <Field label="Herramientas (vacío = todas)" hint="Separadas por comas: Read, Grep, WebFetch…">
          <input className="input font-mono text-xs" value={tools} onChange={(e) => setTools(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Descripción (la ve el modelo para decidir cuándo usarlo)">
          <input className="input" value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} />
        </Field>
        <Field label="System prompt del agente">
          <textarea className="input min-h-48 font-mono text-xs" value={a.systemPrompt} onChange={(e) => setA({ ...a, systemPrompt: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

const EVENTS: HookEvent[] = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart']

function HookEditor({ hook, onClose }: { hook: HookDef | null; onClose: () => void }) {
  const [h, setH] = useState<HookDef>(() => hook ?? { id: '', event: 'PreToolUse', matcher: 'Bash', type: 'block', pattern: '', reason: '', source: 'user', enabled: true })
  const save = () => {
    useExtensions.getState().upsertHook({ ...h, id: hook?.id || uid('user:hook'), source: 'user' })
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={hook ? 'Editar hook' : 'Nuevo hook'} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Evento">
          <select className="input" value={h.event} onChange={(e) => setH({ ...h, event: e.target.value as HookEvent })}>
            {EVENTS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </Field>
        <Field label="Matcher (regex de herramienta)">
          <input className="input font-mono text-xs" value={h.matcher ?? ''} onChange={(e) => setH({ ...h, matcher: e.target.value || undefined })} placeholder="Bash|Write" />
        </Field>
        <Field label="Tipo">
          <select className="input" value={h.type} onChange={(e) => setH({ ...h, type: e.target.value as HookDef['type'] })}>
            <option value="block">Bloqueo por regex</option>
            <option value="command">Comando bash (Claude Code)</option>
            <option value="js">JavaScript</option>
          </select>
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        {h.type === 'block' && (
          <>
            <Field label="Regex (contra el JSON de la entrada)">
              <input className="input font-mono text-xs" value={h.pattern ?? ''} onChange={(e) => setH({ ...h, pattern: e.target.value })} placeholder="rm\\s+-rf" />
            </Field>
            <Field label="Motivo que verá el modelo">
              <input className="input" value={h.reason ?? ''} onChange={(e) => setH({ ...h, reason: e.target.value })} />
            </Field>
          </>
        )}
        {h.type === 'command' && (
          <Field label="Script de bash" hint="Recibe el evento en JSON por stdin (usa jq). exit 2 bloquea con stderr como motivo; en stdout puedes devolver JSON con decision/reason/additionalContext.">
            <textarea className="input min-h-32 font-mono text-xs" value={h.command ?? ''} onChange={(e) => setH({ ...h, command: e.target.value })} />
          </Field>
        )}
        {h.type === 'js' && (
          <Field label="Cuerpo de función async" hint="Recibe `args` (el evento). Devuelve { decision: 'block', reason } o { additionalContext }. Corre en el worker sin red.">
            <textarea className="input min-h-32 font-mono text-xs" value={h.code ?? ''} onChange={(e) => setH({ ...h, code: e.target.value })} />
          </Field>
        )}
      </div>
    </Modal>
  )
}

function McpEditor({ server, onClose }: { server: McpServerDef | null; onClose: () => void }) {
  const [m, setM] = useState<McpServerDef>(() => server ?? { id: '', name: 'mi-servidor', url: 'https://', transport: 'http', connection: 'relay', source: 'user', enabled: true })
  const id = server?.id || `user:mcp:${slugify(m.name)}`
  const token = useSecrets((s) => s.keys[`mcp:${id}`] ?? '')
  const [headers, setHeaders] = useState(JSON.stringify(server?.headers ?? {}, null, 2))
  const [test, setTest] = useState<{ ok: boolean; tools: string[]; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const build = (): McpServerDef | null => {
    const h = safeJsonParse<Record<string, string>>(headers || '{}')
    if (!h.ok) {
      useUi.getState().toast('Las cabeceras no son JSON válido', 'error')
      return null
    }
    return { ...m, id, name: slugify(m.name), headers: Object.keys(h.value).length ? h.value : undefined, source: server?.source ?? 'user' }
  }
  const save = () => {
    const def = build()
    if (!def) return
    if (server && server.source !== 'user') {
      useUi.getState().toast('Los servidores de plugins se configuran en el propio plugin', 'error')
      return
    }
    useExtensions.getState().upsertMcp(def)
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={server ? `Servidor MCP · ${server.name}` : 'Nuevo servidor MCP'} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs text-amber-100/80">
        <TriangleAlert size={13} className="mt-0.5 shrink-0" /> Solo servidores remotos (HTTP/SSE). Sus herramientas siempre piden permiso de red y sus respuestas se tratan como no fiables.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre">
          <input className="input font-mono" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
        </Field>
        <Field label="URL">
          <input className="input font-mono text-xs" value={m.url} onChange={(e) => setM({ ...m, url: e.target.value.trim() })} />
        </Field>
        <Field label="Transporte">
          <select className="input" value={m.transport} onChange={(e) => setM({ ...m, transport: e.target.value as McpServerDef['transport'] })}>
            <option value="http">Streamable HTTP</option>
            <option value="sse">SSE (antiguo)</option>
          </select>
        </Field>
        <Field label="Conexión">
          <select className="input" value={m.connection} onChange={(e) => setM({ ...m, connection: e.target.value as McpServerDef['connection'] })}>
            <option value="relay">Relay propio</option>
            <option value="tunnel">Túnel cifrado</option>
            <option value="direct">Directa</option>
          </select>
        </Field>
        <Field label="Token Bearer (opcional)" hint="Se guarda con tus claves (memoria o bóveda).">
          <input className="input font-mono text-xs" type="password" value={token} onChange={(e) => useSecrets.getState().setKey(`mcp:${id}`, e.target.value.trim())} />
        </Field>
        <Field label="Cabeceras extra (JSON)">
          <textarea className="input min-h-20 font-mono text-xs" value={headers} onChange={(e) => setHeaders(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="btn"
          disabled={testing}
          onClick={async () => {
            const def = build()
            if (!def) return
            setTesting(true)
            setTest(await testMcpServer(def, token))
            setTesting(false)
          }}
        >
          {testing ? <Spinner size={12} /> : <Plug size={13} />} Probar conexión
        </button>
        {test && (test.ok ? <span className="text-xs text-ok">{test.tools.length} herramientas: {test.tools.join(', ')}</span> : <span className="text-xs text-danger">{test.error}</span>)}
      </div>
    </Modal>
  )
}

function ToolEditor({ tool, onClose }: { tool: PluginToolDef | null; onClose: () => void }) {
  const [t, setT] = useState<PluginToolDef>(
    () =>
      tool ?? {
        id: '',
        name: 'mi_herramienta',
        description: 'Qué hace la herramienta (la ve el modelo).',
        inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
        code: 'return args.texto.split("").reverse().join("")',
        readOnly: true,
        network: false,
        source: 'user',
        enabled: true,
      },
  )
  const [schema, setSchema] = useState(JSON.stringify(t.inputSchema, null, 2))
  const [sample, setSample] = useState('{ "texto": "hola" }')
  const [out, setOut] = useState<string | null>(null)
  const save = () => {
    const s = safeJsonParse<Record<string, unknown>>(schema)
    if (!s.ok) return useUi.getState().toast('El esquema no es JSON válido', 'error')
    if (!/^[A-Za-z][\w-]{0,63}$/.test(t.name)) return useUi.getState().toast('Nombre inválido (letras, números, _ y -)', 'error')
    useExtensions.getState().upsertTool({ ...t, inputSchema: s.value, id: tool?.id || `user:tool:${t.name}`, source: 'user' })
    onClose()
  }
  const run = async () => {
    const args = safeJsonParse(sample)
    if (!args.ok) return setOut(`Argumentos inválidos: ${args.error}`)
    const ws = await getWorkspace(ensureSession())
    const r = await runJavaScript(ws, t.code, { args: args.value, timeoutMs: 15_000 })
    setOut([r.result !== undefined ? `→ ${r.result}` : '', r.stdout, r.stderr, r.error ?? ''].filter(Boolean).join('\n') || '(sin salida)')
  }
  return (
    <Modal open onClose={onClose} title={tool ? `Herramienta · ${tool.name}` : 'Nueva herramienta JS'} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre">
          <input className="input font-mono" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <Toggle checked={!!t.readOnly} onChange={(v) => setT({ ...t, readOnly: v })} label="Solo lectura" hint="Permitida en modo plan y sin pedir permiso." />
          <Toggle checked={!!t.network} onChange={(v) => setT({ ...t, network: v })} label="Puede usar la red (host.fetch)" hint="Cada petición pide permiso y pasa por el escudo." />
        </div>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Descripción">
          <input className="input" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} />
        </Field>
        <Field label="Esquema de entrada (JSON Schema)">
          <textarea className="input min-h-28 font-mono text-xs" value={schema} onChange={(e) => setSchema(e.target.value)} />
        </Field>
        <Field label="Código (cuerpo de función async)" hint="Disponibles: args, fs.readFile/writeFile/list/exists/remove, host.exec(cmd), host.fetch(url) si tiene red, console.log. Devuelve el resultado con return.">
          <textarea className="input min-h-36 font-mono text-xs" value={t.code} onChange={(e) => setT({ ...t, code: e.target.value })} />
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input font-mono text-xs" value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Argumentos de prueba" />
          <button className="btn" onClick={run}>
            <Hammer size={13} /> Probar
          </button>
        </div>
        {out !== null && <pre className="glass-inset whitespace-pre-wrap rounded-xl p-3 font-mono text-xs">{out}</pre>}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Instalación
// ---------------------------------------------------------------------------

function InstallBar() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useUi((s) => s.toast)

  const installPlugins = (plugins: Plugin[]) => {
    for (const p of plugins) {
      useExtensions.getState().installPlugin(p)
      toast(
        `Plugin «${p.name}» instalado: ${p.skills.length} skills, ${p.commands.length} comandos, ${p.agents.length} agentes, ${p.hooks.length} hooks, ${p.tools.length} herramientas${p.warnings.length ? ` · ${p.warnings.length} avisos` : ''}`,
        'success',
      )
    }
    if (!plugins.length) toast('No se encontró nada que instalar', 'error')
  }

  const onFiles = async (list: FileList | null) => {
    if (!list) return
    setBusy(true)
    try {
      for (const f of Array.from(list)) {
        if (f.name.endsWith('.zip')) installPlugins(pluginsFromFiles(unzipToFiles(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.zip$/, '')))
        else if (f.name.endsWith('.json')) installPlugins([parseBundleOrManifest(await f.text())])
        else {
          const skill = parseSkillMd(await f.text(), { source: 'user', fallbackName: f.name.replace(/\.md$/i, ''), idPrefix: 'user' })
          useExtensions.getState().upsertSkill(skill)
          toast(`Skill «${skill.name}» instalada`, 'success')
        }
      }
    } catch (e) {
      toast(`No se pudo importar: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onUrl = async () => {
    if (!url.trim()) return
    setBusy(true)
    try {
      const r = await importFromUrl(url.trim())
      installPlugins(r.plugins)
      for (const s of r.skills) {
        useExtensions.getState().upsertSkill(s)
        toast(`Skill «${s.name}» instalada`, 'success')
      }
      setUrl('')
    } catch (e) {
      toast(`No se pudo importar: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fromWorkspace = async () => {
    setBusy(true)
    try {
      const ws = await getWorkspace(ensureSession())
      const files: Record<string, string> = {}
      for (const f of await ws.walk('/workspace')) {
        if (f.size > 512 * 1024) continue
        if (/(^|\/)(SKILL\.md|plugin\.json|hooks\.json|\.mcp\.json)$|\/(commands|agents|skills)\//.test(f.path)) {
          files[f.path.replace('/workspace/', '')] = await ws.readText(f.path)
        }
      }
      // También los archivos de apoyo de las carpetas que contienen un SKILL.md
      const skillDirs = Object.keys(files).filter((p) => p.endsWith('SKILL.md')).map((p) => p.slice(0, p.lastIndexOf('/') + 1))
      for (const f of await ws.walk('/workspace')) {
        const rel = f.path.replace('/workspace/', '')
        if (skillDirs.some((d) => d && rel.startsWith(d)) && !files[rel] && f.size < 512 * 1024) files[rel] = await ws.readText(f.path)
      }
      const plugins = pluginsFromFiles(files, 'workspace')
      if (!plugins.length) toast('No hay SKILL.md ni plugins en el workspace de la conversación actual', 'error')
      else installPlugins(plugins)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass rounded-[var(--radius-glass)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".zip,.json,.md" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileUp size={14} /> Subir .zip, .json o SKILL.md
        </button>
        <button className="btn" onClick={fromWorkspace} disabled={busy}>
          <FolderSearch size={14} /> Desde el workspace
        </button>
        {busy && <Spinner />}
      </div>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          void onUrl()
        }}
      >
        <div className="relative flex-1">
          <GitBranch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9 text-xs" placeholder="URL de GitHub (repo, carpeta o marketplace de plugins de Claude Code), SKILL.md, plugin.json o .zip" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !url.trim()}>
          <Link2 size={14} /> Instalar
        </button>
      </form>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Compatible con plugins y skills de Claude Code. Lo instalado corre dentro del sandbox: los hooks de bash usan el bash virtual, el código JS va a un worker sin red y los servidores MCP stdio no se pueden ejecutar.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function ExtensionsView() {
  const [tab, setTab] = useState<Tab>('skills')
  const st = useExtensions()
  const builtinEnabled = st.builtinEnabled
  const toggle = (id: string, v: boolean) => useExtensions.getState().toggleItem(id, v)
  const plugins = allPlugins()
  const active = plugins.filter((p) => p.enabled)
  const [editing, setEditing] = useState<{ kind: Tab; item: unknown } | null>(null)

  const skills: Skill[] = [...BUILTIN_SKILLS, ...active.flatMap((p) => p.skills), ...st.skills]
  const commands: SlashCommand[] = [...active.flatMap((p) => p.commands), ...st.commands]
  const agents: AgentDef[] = [...BUILTIN_AGENTS, ...active.flatMap((p) => p.agents), ...st.agents]
  const hooks: HookDef[] = [...active.flatMap((p) => p.hooks), ...st.hooks]
  const mcps: McpServerDef[] = [...active.flatMap((p) => p.mcpServers), ...st.mcpServers]
  const tools: PluginToolDef[] = [...active.flatMap((p) => p.tools), ...st.tools]

  const addButton = (label: string) => (
    <button className="btn btn-primary" onClick={() => setEditing({ kind: tab, item: null })}>
      <Plus size={14} /> {label}
    </button>
  )

  return (
    <PageShell>
      <PageHeader icon={<Puzzle size={18} />} title="Extensiones" subtitle="Skills, plugins, comandos, sub-agentes, hooks, servidores MCP y herramientas propias. Instala más desde GitHub o crea las tuyas." />
      <InstallBar />
      <Tabs<Tab>
        className="mt-5"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'skills', label: 'Skills', icon: <Sparkles size={13} />, badge: <span className="text-faint">{skills.length}</span> },
          { id: 'plugins', label: 'Plugins', icon: <Puzzle size={13} />, badge: <span className="text-faint">{plugins.length}</span> },
          { id: 'commands', label: 'Comandos', icon: <Slash size={13} />, badge: <span className="text-faint">{commands.length}</span> },
          { id: 'agents', label: 'Agentes', icon: <Bot size={13} />, badge: <span className="text-faint">{agents.length}</span> },
          { id: 'hooks', label: 'Hooks', icon: <Webhook size={13} />, badge: <span className="text-faint">{hooks.length}</span> },
          { id: 'mcp', label: 'MCP', icon: <Plug size={13} />, badge: <span className="text-faint">{mcps.length}</span> },
          { id: 'tools', label: 'Herramientas', icon: <Wrench size={13} />, badge: <span className="text-faint">{tools.length}</span> },
        ]}
      />
      <div className="mt-4 space-y-2">
        {tab === 'skills' && (
          <>
            <div className="flex justify-end">{addButton('Nueva skill')}</div>
            {skills.map((s) => (
              <Row
                key={s.id}
                title={s.name}
                mono
                subtitle={s.description}
                source={s.source}
                on={isOn(s.id, s.enabled, builtinEnabled)}
                onToggle={(v) => toggle(s.id, v)}
                actions={
                  <>
                    <IconBtn label="Descargar SKILL.md" onClick={() => downloadText(`${s.name}-SKILL.md`, skillToMarkdown(s), 'text/markdown')}>
                      <Download size={14} />
                    </IconBtn>
                    <IconBtn label={s.source === 'user' ? 'Editar' : 'Duplicar y editar'} onClick={() => setEditing({ kind: 'skills', item: s.source === 'user' ? s : { ...s, id: `user:skill:${s.name}-copia`, name: `${s.name}-copia`, source: 'user' } })}>
                      <Pencil size={14} />
                    </IconBtn>
                    {s.source === 'user' && (
                      <IconBtn label="Eliminar" danger onClick={() => useExtensions.getState().removeSkill(s.id)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    )}
                  </>
                }
              />
            ))}
          </>
        )}
        {tab === 'plugins' &&
          (plugins.length ? (
            plugins.map((p) => (
              <div key={p.id} className={cx('glass-inset rounded-2xl px-4 py-3', !p.enabled && 'opacity-55')}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13.5px] font-medium">{p.name}</span>
                      <span className="chip">v{p.version}</span>
                      <span className="chip">{p.source === 'builtin' ? 'De serie' : 'Instalado'}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{p.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-faint">
                      {[
                        [p.skills.length, 'skills'],
                        [p.commands.length, 'comandos'],
                        [p.agents.length, 'agentes'],
                        [p.hooks.length, 'hooks'],
                        [p.mcpServers.length, 'MCP'],
                        [p.tools.length, 'herramientas'],
                        [p.evals.length, 'evals'],
                      ]
                        .filter(([n]) => Number(n) > 0)
                        .map(([n, l]) => (
                          <span key={String(l)} className="chip">
                            {n} {l}
                          </span>
                        ))}
                    </div>
                    {p.warnings.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-[11px] text-amber-100/80">
                        {p.warnings.map((w) => (
                          <li key={w} className="flex items-start gap-1.5">
                            <TriangleAlert size={11} className="mt-0.5 shrink-0" /> {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn label="Exportar como JSON" onClick={() => downloadText(`${p.name}.isc-agent-plugin.json`, exportBundle(p), 'application/json')}>
                      <Download size={14} />
                    </IconBtn>
                    {p.source === 'user' && (
                      <IconBtn
                        label="Desinstalar"
                        danger
                        onClick={() => {
                          if (confirm(`¿Desinstalar ${p.name}?`)) useExtensions.getState().removePlugin(p.id)
                        }}
                      >
                        <Trash2 size={14} />
                      </IconBtn>
                    )}
                    <Toggle checked={p.enabled} onChange={(v) => useExtensions.getState().togglePlugin(p.id, v)} />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <Empty icon={<Puzzle size={22} />} title="Sin plugins" />
          ))}
        {tab === 'commands' && (
          <>
            <div className="flex justify-end">{addButton('Nuevo comando')}</div>
            {commands.length === 0 && <Empty icon={<Slash size={22} />} title="Sin comandos personalizados" />}
            {commands.map((c) => (
              <Row
                key={c.id}
                title={`/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ''}`}
                mono
                subtitle={c.description}
                source={c.source}
                on={isOn(c.id, c.enabled, builtinEnabled)}
                onToggle={(v) => toggle(c.id, v)}
                actions={
                  c.source === 'user' ? (
                    <>
                      <IconBtn label="Editar" onClick={() => setEditing({ kind: 'commands', item: c })}>
                        <Pencil size={14} />
                      </IconBtn>
                      <IconBtn label="Eliminar" danger onClick={() => useExtensions.getState().removeCommand(c.id)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    </>
                  ) : undefined
                }
              />
            ))}
          </>
        )}
        {tab === 'agents' && (
          <>
            <div className="flex justify-end">{addButton('Nuevo sub-agente')}</div>
            {agents.map((a) => (
              <Row
                key={a.id}
                title={a.name}
                mono
                subtitle={`${a.description}${a.tools ? ` · herramientas: ${a.tools.join(', ')}` : ''}`}
                source={a.source}
                on={isOn(a.id, a.enabled, builtinEnabled)}
                onToggle={(v) => toggle(a.id, v)}
                actions={
                  a.source === 'user' ? (
                    <>
                      <IconBtn label="Editar" onClick={() => setEditing({ kind: 'agents', item: a })}>
                        <Pencil size={14} />
                      </IconBtn>
                      <IconBtn label="Eliminar" danger onClick={() => useExtensions.getState().removeAgent(a.id)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    </>
                  ) : undefined
                }
              />
            ))}
            <p className="pt-1 text-[11px] text-faint">Activos ahora: {enabledAgents().map((a) => a.name).join(', ')}</p>
          </>
        )}
        {tab === 'hooks' && (
          <>
            <div className="flex justify-end">{addButton('Nuevo hook')}</div>
            {hooks.map((h) => (
              <Row
                key={h.id}
                title={`${h.event}${h.matcher ? ` · ${h.matcher}` : ''}`}
                mono
                subtitle={h.type === 'block' ? `Bloquea /${h.pattern}/ — ${h.reason ?? ''}` : h.type === 'command' ? h.command : h.code?.split('\n')[0]}
                source={h.source}
                on={isOn(h.id, h.enabled, builtinEnabled)}
                onToggle={(v) => toggle(h.id, v)}
                actions={
                  h.source === 'user' ? (
                    <>
                      <IconBtn label="Editar" onClick={() => setEditing({ kind: 'hooks', item: h })}>
                        <Pencil size={14} />
                      </IconBtn>
                      <IconBtn label="Eliminar" danger onClick={() => useExtensions.getState().removeHook(h.id)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    </>
                  ) : undefined
                }
              />
            ))}
          </>
        )}
        {tab === 'mcp' && (
          <>
            <div className="flex justify-end">{addButton('Añadir servidor MCP')}</div>
            {mcps.length === 0 && (
              <Empty icon={<Plug size={22} />} title="Sin servidores MCP">
                Conecta servidores MCP remotos (Streamable HTTP o SSE). Sus herramientas aparecen como mcp__servidor__herramienta.
              </Empty>
            )}
            {mcps.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                mono
                subtitle={`${m.url} · ${m.transport} · ${m.connection === 'relay' ? 'relay' : m.connection === 'tunnel' ? 'túnel' : 'directo'}`}
                source={m.source}
                on={isOn(m.id, m.enabled, builtinEnabled)}
                onToggle={(v) => toggle(m.id, v)}
                actions={
                  <>
                    <IconBtn label="Configurar" onClick={() => setEditing({ kind: 'mcp', item: m })}>
                      <Pencil size={14} />
                    </IconBtn>
                    {m.source === 'user' && (
                      <IconBtn label="Eliminar" danger onClick={() => useExtensions.getState().removeMcp(m.id)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    )}
                  </>
                }
              />
            ))}
          </>
        )}
        {tab === 'tools' && (
          <>
            <div className="flex justify-end">{addButton('Nueva herramienta JS')}</div>
            {tools.map((t) => (
              <Row
                key={t.id}
                title={t.name}
                mono
                subtitle={`${t.description}${t.network ? ' · usa la red' : ''}`}
                source={t.source}
                on={isOn(t.id, t.enabled, builtinEnabled)}
                onToggle={(v) => toggle(t.id, v)}
                actions={
                  <>
                    <IconBtn label={t.source === 'user' ? 'Editar' : 'Ver y probar'} onClick={() => setEditing({ kind: 'tools', item: t })}>
                      <Pencil size={14} />
                    </IconBtn>
                    {t.source === 'user' && (
                      <IconBtn label="Eliminar" danger onClick={() => useExtensions.getState().removeTool(t.id)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    )}
                  </>
                }
              />
            ))}
          </>
        )}
      </div>

      {editing?.kind === 'skills' && <SkillEditor skill={editing.item as Skill | null} onClose={() => setEditing(null)} />}
      {editing?.kind === 'commands' && <CommandEditor cmd={editing.item as SlashCommand | null} onClose={() => setEditing(null)} />}
      {editing?.kind === 'agents' && <AgentEditor agent={editing.item as AgentDef | null} onClose={() => setEditing(null)} />}
      {editing?.kind === 'hooks' && <HookEditor hook={editing.item as HookDef | null} onClose={() => setEditing(null)} />}
      {editing?.kind === 'mcp' && <McpEditor server={editing.item as McpServerDef | null} onClose={() => setEditing(null)} />}
      {editing?.kind === 'tools' && <ToolEditor tool={editing.item as PluginToolDef | null} onClose={() => setEditing(null)} />}
    </PageShell>
  )
}
