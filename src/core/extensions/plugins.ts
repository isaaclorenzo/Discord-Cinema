// Importación de plugins y skills.
//
// Formatos admitidos:
// 1. Plugins de Claude Code (carpeta con .claude-plugin/plugin.json): skills/,
//    commands/, agents/, hooks/hooks.json y .mcp.json. También marketplaces
//    (.claude-plugin/marketplace.json) con varios plugins.
// 2. Carpetas o zips con uno o varios SKILL.md sueltos.
// 3. Bundle JSON propio de Glasshouse ({ "format": "glasshouse-plugin", … }),
//    que además admite herramientas JS ("tools") y suites de evaluación.

import { unzipSync } from 'fflate'
import { netFetch } from '../net'
import { parseFrontmatter, parseSkillMd, slugify } from './skills'
import type { AgentDef, EvalSuite, HookDef, HookEvent, McpServerDef, Plugin, PluginToolDef, Skill, SlashCommand } from './types'

const MAX_FILE = 512 * 1024
const MAX_TOTAL = 8 * 1024 * 1024
const HOOK_EVENTS: HookEvent[] = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart']

export type FileMap = Record<string, string>

function isTextPath(p: string): boolean {
  return !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|tar|wasm|woff2?|ttf|otf|mp3|mp4|mov|bin|exe|dll|so|dylib|pyc)$/i.test(p)
}

/** Descomprime un zip en un mapa ruta → texto (ignora binarios y archivos enormes). */
export function unzipToFiles(data: Uint8Array): FileMap {
  const entries = unzipSync(data)
  const out: FileMap = {}
  let total = 0
  const decoder = new TextDecoder('utf-8', { fatal: false })
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/') || !isTextPath(path) || bytes.length > MAX_FILE) continue
    if (bytes.subarray(0, 2048).includes(0)) continue
    total += bytes.length
    if (total > MAX_TOTAL) break
    out[path.replace(/^\/+/, '')] = decoder.decode(bytes)
  }
  return stripCommonRoot(out)
}

/** Quita la carpeta raíz común (p. ej. "repo-main/" de los zips de GitHub). */
export function stripCommonRoot(files: FileMap): FileMap {
  const paths = Object.keys(files)
  if (paths.length === 0) return files
  const first = paths[0].split('/')[0]
  if (paths.every((p) => p.startsWith(`${first}/`)) && paths.some((p) => p.split('/').length > 1)) {
    return Object.fromEntries(Object.entries(files).map(([p, c]) => [p.slice(first.length + 1), c]))
  }
  return files
}

function subtree(files: FileMap, root: string): FileMap {
  const prefix = root ? `${root.replace(/\/+$/, '')}/` : ''
  const out: FileMap = {}
  for (const [p, c] of Object.entries(files)) if (p.startsWith(prefix)) out[p.slice(prefix.length)] = c
  return out
}

function toList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return undefined
}

function asArray(v: unknown): string[] {
  if (!v) return []
  return Array.isArray(v) ? v.map(String) : [String(v)]
}

function emptyPlugin(name: string, source: Plugin['source']): Plugin {
  return {
    id: `${source}:plugin:${slugify(name)}`,
    name: slugify(name),
    version: '0.0.0',
    description: '',
    enabled: true,
    source,
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    mcpServers: [],
    tools: [],
    evals: [],
    files: {},
    warnings: [],
  }
}

function collectSkills(files: FileMap, base: string, src: `plugin:${string}` | 'user' | 'builtin', idPrefix: string): Skill[] {
  const out: Skill[] = []
  for (const path of Object.keys(files)) {
    if (!path.startsWith(base) || !/(^|\/)SKILL\.md$/i.test(path)) continue
    const dir = path.slice(0, path.lastIndexOf('/') + 1)
    const supporting: Record<string, string> = {}
    for (const [p, c] of Object.entries(files)) {
      if (p !== path && p.startsWith(dir) && dir !== '') supporting[p.slice(dir.length)] = c
    }
    const fallback = dir.split('/').filter(Boolean).pop() ?? 'skill'
    out.push(parseSkillMd(files[path], { source: src, fallbackName: fallback, files: supporting, idPrefix }))
  }
  return out
}

function parseCommands(files: FileMap, dirs: string[], src: `plugin:${string}`, idPrefix: string): SlashCommand[] {
  const out: SlashCommand[] = []
  for (const [path, text] of Object.entries(files)) {
    const dir = dirs.find((d) => path.startsWith(`${d.replace(/\/+$/, '')}/`))
    if (!dir || !path.endsWith('.md')) continue
    const rel = path.slice(dir.replace(/\/+$/, '').length + 1, -3)
    const name = rel.split('/').map(slugify).join(':')
    const { data, body } = parseFrontmatter(text)
    out.push({
      id: `${idPrefix}:command:${name}`,
      name,
      description: String(data.description ?? body.trim().split('\n')[0]?.replace(/^#+\s*/, '') ?? name).slice(0, 200),
      argumentHint: data['argument-hint'] ? String(data['argument-hint']) : undefined,
      allowedTools: toList(data['allowed-tools']),
      template: body.trim(),
      source: src,
      enabled: true,
    })
  }
  return out
}

function parseAgents(files: FileMap, dirs: string[], src: `plugin:${string}`, idPrefix: string): AgentDef[] {
  const out: AgentDef[] = []
  for (const [path, text] of Object.entries(files)) {
    const dir = dirs.find((d) => path.startsWith(`${d.replace(/\/+$/, '')}/`))
    if (!dir || !path.endsWith('.md')) continue
    const { data, body } = parseFrontmatter(text)
    const name = slugify(String(data.name ?? path.split('/').pop()!.slice(0, -3)))
    out.push({
      id: `${idPrefix}:agent:${name}`,
      name,
      description: String(data.description ?? '').trim() || name,
      systemPrompt: body.trim(),
      tools: toList(data.tools),
      model: 'inherit',
      source: src,
      enabled: true,
    })
  }
  return out
}

interface CcHookEntry {
  matcher?: string
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>
}

export function parseHooksJson(json: unknown, src: `plugin:${string}` | 'user', idPrefix: string, pluginRoot: string, warnings: string[]): HookDef[] {
  const root = (json as { hooks?: Record<string, CcHookEntry[]> })?.hooks ?? (json as Record<string, CcHookEntry[]>)
  const out: HookDef[] = []
  if (!root || typeof root !== 'object') return out
  for (const [event, entries] of Object.entries(root)) {
    if (!HOOK_EVENTS.includes(event as HookEvent)) {
      if (Array.isArray(entries)) warnings.push(`Evento de hook no soportado: ${event}`)
      continue
    }
    for (const [i, entry] of (Array.isArray(entries) ? entries : []).entries()) {
      for (const [j, h] of (entry.hooks ?? []).entries()) {
        if (h.type && h.type !== 'command') {
          warnings.push(`Hook de tipo "${h.type}" no soportado (${event})`)
          continue
        }
        if (!h.command) continue
        out.push({
          id: `${idPrefix}:hook:${event}:${i}:${j}`,
          event: event as HookEvent,
          matcher: entry.matcher,
          type: 'command',
          command: h.command,
          timeoutMs: h.timeout ? h.timeout * 1000 : undefined,
          source: src,
          enabled: true,
          pluginRoot,
        })
      }
    }
  }
  return out
}

export function parseMcpJson(json: unknown, src: `plugin:${string}` | 'user', idPrefix: string, warnings: string[]): McpServerDef[] {
  const servers = (json as { mcpServers?: Record<string, Record<string, unknown>> })?.mcpServers ?? (json as Record<string, Record<string, unknown>>)
  const out: McpServerDef[] = []
  if (!servers || typeof servers !== 'object') return out
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') continue
    const url = typeof cfg.url === 'string' ? cfg.url : undefined
    if (!url || cfg.command) {
      warnings.push(`Servidor MCP "${name}" usa stdio (un proceso local): no se puede ejecutar en el navegador.`)
      continue
    }
    out.push({
      id: `${idPrefix}:mcp:${slugify(name)}`,
      name: slugify(name),
      url,
      transport: cfg.type === 'sse' ? 'sse' : 'http',
      headers: (cfg.headers as Record<string, string>) ?? undefined,
      connection: 'relay',
      source: src,
      enabled: false, // los servidores remotos se activan a mano
    })
  }
  return out
}

function parseToolsField(v: unknown, files: FileMap, src: `plugin:${string}`, idPrefix: string, warnings: string[]): PluginToolDef[] {
  if (!Array.isArray(v)) return []
  const out: PluginToolDef[] = []
  for (const t of v as Array<Record<string, unknown>>) {
    const name = String(t.name ?? '')
    if (!/^[A-Za-z][\w-]{0,63}$/.test(name)) {
      warnings.push(`Herramienta con nombre inválido: "${name}"`)
      continue
    }
    const code = typeof t.code === 'string' ? t.code : typeof t.file === 'string' ? files[t.file] : undefined
    if (!code) {
      warnings.push(`La herramienta ${name} no tiene código`)
      continue
    }
    out.push({
      id: `${idPrefix}:tool:${name}`,
      name,
      description: String(t.description ?? name),
      inputSchema: (t.inputSchema ?? t.input_schema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      code,
      network: Boolean(t.network),
      readOnly: Boolean(t.readOnly),
      source: src,
      enabled: true,
    })
  }
  return out
}

function parseEvals(v: unknown, files: FileMap, src: `plugin:${string}`, idPrefix: string): EvalSuite[] {
  const suites: unknown[] = Array.isArray(v) ? v : []
  for (const [p, c] of Object.entries(files)) {
    if (/^evals\/.+\.json$/.test(p)) {
      try {
        suites.push(JSON.parse(c))
      } catch {
        /* se ignora */
      }
    }
  }
  return suites
    .filter((s): s is EvalSuite => !!s && typeof s === 'object' && Array.isArray((s as EvalSuite).tasks))
    .map((s, i) => ({ ...s, id: `${idPrefix}:eval:${slugify(s.name ?? String(i))}`, source: src }))
}

/** Plugin con estructura de Claude Code, a partir de los archivos de su carpeta. */
export function parseClaudePlugin(files: FileMap, fallbackName = 'plugin'): Plugin {
  let manifest: Record<string, unknown> = {}
  const manifestText = files['.claude-plugin/plugin.json'] ?? files['plugin.json']
  const warnings: string[] = []
  if (manifestText) {
    try {
      manifest = JSON.parse(manifestText)
    } catch {
      warnings.push('plugin.json no es JSON válido')
    }
  }
  const name = slugify(String(manifest.name ?? fallbackName))
  const p = emptyPlugin(name, 'user')
  const src = `plugin:${name}` as const
  const idPrefix = `plugin:${name}`
  p.version = String(manifest.version ?? '0.0.0')
  p.description = String(manifest.description ?? '')
  const author = manifest.author as { name?: string } | string | undefined
  p.author = typeof author === 'string' ? author : author?.name
  p.homepage = typeof manifest.homepage === 'string' ? manifest.homepage : typeof manifest.repository === 'string' ? manifest.repository : undefined

  const strip = (d: string) => d.replace(/^\.\//, '').replace(/\/+$/, '')
  const commandDirs = ['commands', ...asArray(manifest.commands).map(strip)]
  const agentDirs = ['agents', ...asArray(manifest.agents).map(strip)]
  p.commands = parseCommands(files, commandDirs, src, idPrefix)
  p.agents = parseAgents(files, agentDirs, src, idPrefix)
  p.skills = collectSkills(files, '', src, idPrefix).filter((s) => !s.id.includes('/'))

  const pluginRoot = `/plugins/${name}`
  const hookSources: unknown[] = []
  if (files['hooks/hooks.json']) hookSources.push(files['hooks/hooks.json'])
  if (typeof manifest.hooks === 'string' && files[strip(manifest.hooks)]) hookSources.push(files[strip(manifest.hooks)])
  else if (manifest.hooks && typeof manifest.hooks === 'object') hookSources.push(manifest.hooks)
  for (const h of hookSources) {
    try {
      p.hooks.push(...parseHooksJson(typeof h === 'string' ? JSON.parse(h) : h, src, idPrefix, pluginRoot, warnings))
    } catch {
      warnings.push('hooks.json no es JSON válido')
    }
  }

  const mcpSources: unknown[] = []
  if (files['.mcp.json']) mcpSources.push(files['.mcp.json'])
  if (typeof manifest.mcpServers === 'string' && files[strip(manifest.mcpServers)]) mcpSources.push(files[strip(manifest.mcpServers)])
  else if (manifest.mcpServers && typeof manifest.mcpServers === 'object') mcpSources.push({ mcpServers: manifest.mcpServers })
  for (const m of mcpSources) {
    try {
      p.mcpServers.push(...parseMcpJson(typeof m === 'string' ? JSON.parse(m) : m, src, idPrefix, warnings))
    } catch {
      warnings.push('.mcp.json no es JSON válido')
    }
  }

  p.tools = parseToolsField(manifest.tools, files, src, idPrefix, warnings)
  p.evals = parseEvals(manifest.evals, files, src, idPrefix)
  p.files = Object.fromEntries(Object.entries(files).filter(([path]) => !path.startsWith('.git/')))
  p.warnings = warnings
  return p
}

/** Bundle JSON de Glasshouse. */
export function parseBundle(json: Record<string, unknown>): Plugin {
  const name = slugify(String(json.name ?? 'plugin'))
  const p = emptyPlugin(name, 'user')
  const src = `plugin:${name}` as const
  const idPrefix = `plugin:${name}`
  p.version = String(json.version ?? '0.0.0')
  p.description = String(json.description ?? '')
  p.author = typeof json.author === 'string' ? json.author : undefined
  const files = (json.files as FileMap) ?? {}
  const warnings: string[] = []
  p.skills = ((json.skills as Array<Record<string, unknown>>) ?? []).map((s) => ({
    id: `${idPrefix}:skill:${slugify(String(s.name))}`,
    name: slugify(String(s.name)),
    description: String(s.description ?? ''),
    body: String(s.body ?? s.instructions ?? ''),
    allowedTools: toList(s.allowedTools),
    files: (s.files as Record<string, string>) ?? {},
    source: src,
    enabled: true,
  }))
  p.commands = ((json.commands as Array<Record<string, unknown>>) ?? []).map((c) => ({
    id: `${idPrefix}:command:${slugify(String(c.name))}`,
    name: slugify(String(c.name)),
    description: String(c.description ?? ''),
    argumentHint: c.argumentHint ? String(c.argumentHint) : undefined,
    template: String(c.template ?? c.prompt ?? ''),
    source: src,
    enabled: true,
  }))
  p.agents = ((json.agents as Array<Record<string, unknown>>) ?? []).map((a) => ({
    id: `${idPrefix}:agent:${slugify(String(a.name))}`,
    name: slugify(String(a.name)),
    description: String(a.description ?? ''),
    systemPrompt: String(a.systemPrompt ?? a.prompt ?? ''),
    tools: toList(a.tools),
    model: 'inherit',
    source: src,
    enabled: true,
  }))
  p.hooks = ((json.hooks as Array<Record<string, unknown>>) ?? [])
    .filter((h) => HOOK_EVENTS.includes(h.event as HookEvent))
    .map((h, i) => ({
      id: `${idPrefix}:hook:${i}`,
      event: h.event as HookEvent,
      matcher: h.matcher ? String(h.matcher) : undefined,
      type: (['command', 'js', 'block'].includes(String(h.type)) ? h.type : 'command') as HookDef['type'],
      command: h.command ? String(h.command) : undefined,
      code: h.code ? String(h.code) : undefined,
      pattern: h.pattern ? String(h.pattern) : undefined,
      reason: h.reason ? String(h.reason) : undefined,
      source: src,
      enabled: true,
      pluginRoot: `/plugins/${name}`,
    }))
  if (json.mcpServers) p.mcpServers = parseMcpJson({ mcpServers: json.mcpServers }, src, idPrefix, warnings)
  p.tools = parseToolsField(json.tools, files, src, idPrefix, warnings)
  p.evals = parseEvals(json.evals, {}, src, idPrefix)
  p.files = files
  p.warnings = warnings
  return p
}

/** Detecta qué hay en un conjunto de archivos y devuelve los plugins encontrados. */
export function pluginsFromFiles(files: FileMap, fallbackName: string): Plugin[] {
  const marketplace = files['.claude-plugin/marketplace.json']
  if (marketplace) {
    try {
      const m = JSON.parse(marketplace) as { plugins?: Array<{ name?: string; source?: string | { source?: string; path?: string } }> }
      const out: Plugin[] = []
      for (const entry of m.plugins ?? []) {
        const src = typeof entry.source === 'string' ? entry.source : entry.source?.path
        if (!src || /^https?:|^github:/.test(src)) continue
        const sub = subtree(files, src.replace(/^\.\//, ''))
        if (Object.keys(sub).length) out.push(parseClaudePlugin(sub, entry.name ?? src))
      }
      if (out.length) return out
    } catch {
      /* continúa con la detección normal */
    }
  }
  // Varias carpetas con plugin.json
  const roots = Object.keys(files)
    .filter((p) => p.endsWith('.claude-plugin/plugin.json'))
    .map((p) => p.slice(0, -'.claude-plugin/plugin.json'.length).replace(/\/+$/, ''))
  if (roots.length) return roots.map((r) => parseClaudePlugin(subtree(files, r), r.split('/').pop() || fallbackName))

  // Bundle JSON dentro del zip
  const bundle = Object.entries(files).find(([p, c]) => p.endsWith('.json') && c.includes('"glasshouse-plugin"'))
  if (bundle) {
    try {
      return [parseBundle(JSON.parse(bundle[1]))]
    } catch {
      /* continúa */
    }
  }

  // Solo skills sueltas
  const p = emptyPlugin(fallbackName, 'user')
  const name = p.name
  p.skills = collectSkills(files, '', `plugin:${name}`, `plugin:${name}`)
  p.commands = parseCommands(files, ['commands'], `plugin:${name}`, `plugin:${name}`)
  p.agents = parseAgents(files, ['agents'], `plugin:${name}`, `plugin:${name}`)
  if (p.skills.length + p.commands.length + p.agents.length === 0) return []
  p.description = `${p.skills.length} skills importadas`
  p.files = files
  return [p]
}

export function parseGithubUrl(url: string): { owner: string; repo: string; ref?: string; path?: string } | null {
  const m = url.trim().match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?\/?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2], ref: m[3], path: m[4]?.replace(/\/SKILL\.md$/i, '') }
}

/** Descarga un repositorio de GitHub (zip vía relay) y extrae sus plugins o skills. */
export async function importFromGithub(url: string): Promise<Plugin[]> {
  const gh = parseGithubUrl(url)
  if (!gh) throw new Error('URL de GitHub no válida (usa https://github.com/usuario/repo)')
  const refs = gh.ref ? [gh.ref] : ['main', 'master']
  let lastErr = ''
  for (const ref of refs) {
    const zipUrl = `https://codeload.github.com/${gh.owner}/${gh.repo}/zip/refs/heads/${ref}`
    const res = await netFetch(zipUrl, { method: 'GET' }, { purpose: 'install', label: `GitHub · ${gh.owner}/${gh.repo}`, via: 'relay', follow: true, maxBytes: 40 * 1024 * 1024 })
    if (!res.ok) {
      lastErr = `HTTP ${res.status}`
      continue
    }
    let files = unzipToFiles(new Uint8Array(await res.arrayBuffer()))
    if (gh.path) files = subtree(files, gh.path)
    const plugins = pluginsFromFiles(files, gh.path?.split('/').pop() || gh.repo)
    if (!plugins.length) throw new Error('No se encontraron plugins ni skills en ese repositorio')
    return plugins.map((p) => ({ ...p, homepage: p.homepage ?? url }))
  }
  throw new Error(`No se pudo descargar el repositorio (${lastErr})`)
}

/** Importa desde una URL a un SKILL.md, un plugin.json/bundle JSON o un zip. */
export async function importFromUrl(url: string): Promise<{ plugins: Plugin[]; skills: Skill[] }> {
  if (/github\.com\//.test(url) && !/raw\.githubusercontent/.test(url) && !/\/blob\//.test(url)) return { plugins: await importFromGithub(url), skills: [] }
  const raw = url.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//, 'https://raw.githubusercontent.com/$1/$2/')
  const res = await netFetch(raw, { method: 'GET' }, { purpose: 'install', label: `Instalar · ${new URL(raw).hostname}`, via: 'relay', follow: true, maxBytes: 40 * 1024 * 1024 })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (/\.zip($|\?)/.test(raw)) return { plugins: pluginsFromFiles(unzipToFiles(new Uint8Array(await res.arrayBuffer())), 'plugin'), skills: [] }
  const text = await res.text()
  if (/\.json($|\?)/.test(raw) || text.trim().startsWith('{')) return { plugins: [parseBundleOrManifest(text)], skills: [] }
  return { plugins: [], skills: [parseSkillMd(text, { source: 'user', fallbackName: raw.split('/').slice(-2, -1)[0] ?? 'skill' })] }
}

export function parseBundleOrManifest(text: string): Plugin {
  const json = JSON.parse(text) as Record<string, unknown>
  if (json.format === 'glasshouse-plugin') return parseBundle(json)
  return parseClaudePlugin({ '.claude-plugin/plugin.json': text }, String(json.name ?? 'plugin'))
}

/** Exporta un plugin como bundle JSON de Glasshouse. */
export function exportBundle(p: Plugin): string {
  return JSON.stringify(
    {
      format: 'glasshouse-plugin',
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      skills: p.skills.map((s) => ({ name: s.name, description: s.description, body: s.body, allowedTools: s.allowedTools, files: s.files })),
      commands: p.commands.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint, template: c.template })),
      agents: p.agents.map((a) => ({ name: a.name, description: a.description, systemPrompt: a.systemPrompt, tools: a.tools })),
      hooks: p.hooks.map((h) => ({ event: h.event, matcher: h.matcher, type: h.type, command: h.command, code: h.code, pattern: h.pattern, reason: h.reason })),
      mcpServers: Object.fromEntries(p.mcpServers.map((m) => [m.name, { type: m.transport, url: m.url, headers: m.headers }])),
      tools: p.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, code: t.code, network: t.network, readOnly: t.readOnly })),
      evals: p.evals,
      files: p.files,
    },
    null,
    2,
  )
}
