// Herramientas de archivos (Read, Write, Edit, MultiEdit, LS, Glob, Grep,
// NotebookEdit). Mismos nombres y parámetros que Claude Code; operan sobre el
// VFS aislado del workspace.

import { minimatch } from 'minimatch'
import { createTwoFilesPatch } from 'diff'
import { HOME, basename } from '../sandbox/workspace'
import type { Workspace } from '../sandbox/workspace'
import { bytesToBase64, imageMediaType, looksTextual } from '../util'
import { errorResult, type ToolDef, type ToolResult } from './types'

const MAX_READ_LINES = 2000
const MAX_LINE_CHARS = 2000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function numbered(lines: string[], start: number): string {
  return lines
    .map((l, i) => {
      const n = String(start + i).padStart(6, ' ')
      const text = l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}… [línea truncada]` : l
      return `${n}\t${text}`
    })
    .join('\n')
}

async function assertFreshRead(ws: Workspace, path: string): Promise<string | null> {
  const p = ws.resolve(path)
  if (!(await ws.fs.exists(p))) return null
  const seen = ws.readState.get(p)
  if (seen === undefined) {
    return `File has not been read yet. Read it first with the Read tool before writing to it: ${p}`
  }
  const st = await ws.fs.stat(p)
  if (st.mtime.getTime() > seen) {
    return `File has been modified since it was read (by the user or another tool). Read it again before editing: ${p}`
  }
  return null
}

function diffDisplay(path: string, before: string, after: string) {
  const patch = createTwoFilesPatch(path, path, before, after, '', '', { context: 3 })
  const added = after === '' ? 0 : patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
  const removed = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length
  return { kind: 'diff' as const, path, patch, added, removed, isNew: before === '' }
}

// ---------------------------------------------------------------------------

export const ReadTool: ToolDef<{ file_path: string; offset?: number; limit?: number }> = {
  name: 'Read',
  description: `Reads a file from the sandboxed workspace filesystem.

Usage:
- file_path may be absolute (e.g. /workspace/src/app.py) or relative to the current working directory (/workspace by default).
- By default reads up to ${MAX_READ_LINES} lines from the start. Use offset (1-based line number) and limit for long files.
- Output uses cat -n format: line numbers followed by a tab, then the line content. Never include the line-number prefix in old_string when editing.
- Lines longer than ${MAX_LINE_CHARS} characters are truncated.
- Images (png, jpg, gif, webp) are returned as images you can see.
- Jupyter notebooks (.ipynb) are returned with all cells and outputs.
- You can call several Read tools in parallel when you need multiple files.`,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to read' },
      offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
      limit: { type: 'number', description: 'Number of lines to read' },
    },
    required: ['file_path'],
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => i.file_path,
  matchKey: (i) => i.file_path,
  async run(input, { ws }) {
    const p = ws.resolve(input.file_path)
    if (!(await ws.fs.exists(p))) return errorResult(`File does not exist: ${p}`)
    const st = await ws.fs.stat(p)
    if (st.isDirectory) return errorResult(`${p} is a directory. Use LS or Bash (ls) to list it.`)
    const bytes = await ws.readBytes(p)
    ws.readState.set(p, st.mtime.getTime())

    const media = imageMediaType(p)
    if (media) {
      if (bytes.length > MAX_IMAGE_BYTES) return errorResult(`Image too large (${bytes.length} bytes, max ${MAX_IMAGE_BYTES}).`)
      return {
        content: `Image file ${p} (${bytes.length} bytes) attached.`,
        images: [{ mediaType: media, data: bytesToBase64(bytes) }],
        display: { kind: 'files', files: [p] },
      }
    }
    if (!looksTextual(p, bytes)) return errorResult(`${p} appears to be a binary file (${bytes.length} bytes); it cannot be read as text.`)

    const text = new TextDecoder().decode(bytes)
    if (p.endsWith('.ipynb')) {
      try {
        return { content: renderNotebook(JSON.parse(text)) }
      } catch {
        /* se lee como texto normal */
      }
    }
    if (text.length === 0) {
      return { content: `<system-reminder>The file ${p} exists but is empty.</system-reminder>` }
    }
    const lines = text.split('\n')
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    const start = Math.max(1, Math.floor(input.offset ?? 1))
    const limit = Math.max(1, Math.floor(input.limit ?? MAX_READ_LINES))
    const slice = lines.slice(start - 1, start - 1 + limit)
    if (slice.length === 0) return errorResult(`offset ${start} is past the end of the file (${lines.length} lines).`)
    let content = numbered(slice, start)
    const end = start - 1 + slice.length
    if (end < lines.length) content += `\n\n[Showing lines ${start}-${end} of ${lines.length}. Use offset/limit to read more.]`
    return { content }
  },
}

function renderNotebook(nb: { cells?: Array<Record<string, unknown>> }): string {
  const cells = nb.cells ?? []
  return cells
    .map((c, i) => {
      const src = Array.isArray(c.source) ? (c.source as string[]).join('') : String(c.source ?? '')
      const id = (c.id as string) ?? `cell-${i}`
      let out = `<cell id="${id}" index="${i}" type="${c.cell_type}">\n${src}\n</cell>`
      const outputs = (c.outputs as Array<Record<string, unknown>>) ?? []
      for (const o of outputs) {
        const t = o.text ?? (o.data as Record<string, unknown> | undefined)?.['text/plain']
        if (t) out += `\n<output>${Array.isArray(t) ? t.join('') : String(t)}</output>`
      }
      return out
    })
    .join('\n\n')
}

export const WriteTool: ToolDef<{ file_path: string; content: string }> = {
  name: 'Write',
  description: `Writes a file to the sandboxed workspace, creating parent directories as needed.

Usage:
- This overwrites the existing file if there is one. If the file already exists you MUST Read it first, otherwise the call fails.
- Prefer Edit for modifying existing files; use Write for new files or complete rewrites.
- Only create documentation files (*.md) when explicitly asked.`,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to write' },
      content: { type: 'string', description: 'Full content of the file' },
    },
    required: ['file_path', 'content'],
  },
  readOnly: false,
  permission: 'edit',
  summarize: (i) => i.file_path,
  matchKey: (i) => i.file_path,
  async run(input, { ws }) {
    const p = ws.resolve(input.file_path)
    if (typeof input.content !== 'string') return errorResult('content must be a string')
    const stale = await assertFreshRead(ws, p)
    if (stale) return errorResult(stale)
    const before = (await ws.fs.exists(p)) ? await ws.readText(p) : ''
    await ws.writeFile(p, input.content)
    const lines = input.content.split('\n').length
    return {
      content: before ? `File ${p} has been overwritten (${lines} lines).` : `File created successfully at ${p} (${lines} lines).`,
      display: diffDisplay(p, before, input.content),
    }
  },
}

function applyEdit(text: string, oldS: string, newS: string, replaceAll: boolean): { text: string } | { error: string } {
  if (oldS === newS) return { error: 'old_string and new_string are identical; nothing to change.' }
  if (oldS === '') return { error: 'old_string is empty. To create a file use Write.' }
  const count = text.split(oldS).length - 1
  if (count === 0) {
    const hint = text.includes(oldS.trim()) ? ' (it matches after trimming whitespace: check indentation)' : ''
    return { error: `old_string was not found in the file${hint}. Make sure it matches exactly, including whitespace.` }
  }
  if (count > 1 && !replaceAll) {
    return {
      error: `old_string appears ${count} times. Provide more surrounding context to make it unique, or set replace_all to true.`,
    }
  }
  return { text: replaceAll ? text.split(oldS).join(newS) : text.replace(oldS, () => newS) }
}

export const EditTool: ToolDef<{ file_path: string; old_string: string; new_string: string; replace_all?: boolean }> = {
  name: 'Edit',
  description: `Performs an exact string replacement in a file of the sandboxed workspace.

Usage:
- You must Read the file at least once before editing; otherwise the edit fails.
- old_string must match the file exactly (including indentation). Do not include the line-number prefix from Read output.
- The edit fails if old_string is not unique; add surrounding context or use replace_all to change every occurrence.
- To create a new file, use Write. Use replace_all for renaming a variable across the file.`,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to modify' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text (must differ from old_string)' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  readOnly: false,
  permission: 'edit',
  summarize: (i) => i.file_path,
  matchKey: (i) => i.file_path,
  async run(input, { ws }) {
    const p = ws.resolve(input.file_path)
    if (!(await ws.fs.exists(p))) return errorResult(`File does not exist: ${p}. Use Write to create it.`)
    const stale = await assertFreshRead(ws, p)
    if (stale) return errorResult(stale)
    const before = await ws.readText(p)
    const r = applyEdit(before, input.old_string, input.new_string, Boolean(input.replace_all))
    if ('error' in r) return errorResult(r.error)
    await ws.writeFile(p, r.text)
    return { content: `The file ${p} has been updated.`, display: diffDisplay(p, before, r.text) }
  },
}

export const MultiEditTool: ToolDef<{
  file_path: string
  edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>
}> = {
  name: 'MultiEdit',
  description: `Makes several exact string replacements to one file in a single atomic operation.

Usage:
- Same rules as Edit for each item; edits apply in order, each one on the result of the previous.
- If any edit fails, none are applied. You must Read the file first.`,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      edits: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          required: ['old_string', 'new_string'],
        },
      },
    },
    required: ['file_path', 'edits'],
  },
  readOnly: false,
  permission: 'edit',
  summarize: (i) => `${i.file_path} (${i.edits?.length ?? 0} cambios)`,
  matchKey: (i) => i.file_path,
  async run(input, { ws }) {
    const p = ws.resolve(input.file_path)
    if (!(await ws.fs.exists(p))) return errorResult(`File does not exist: ${p}`)
    const stale = await assertFreshRead(ws, p)
    if (stale) return errorResult(stale)
    const before = await ws.readText(p)
    let text = before
    for (const [i, e] of (input.edits ?? []).entries()) {
      const r = applyEdit(text, e.old_string, e.new_string, Boolean(e.replace_all))
      if ('error' in r) return errorResult(`Edit #${i + 1} failed: ${r.error} No changes were applied.`)
      text = r.text
    }
    await ws.writeFile(p, text)
    return { content: `Applied ${input.edits.length} edits to ${p}.`, display: diffDisplay(p, before, text) }
  },
}

export const LSTool: ToolDef<{ path?: string; ignore?: string[] }> = {
  name: 'LS',
  description: 'Lists files and directories in a path of the sandboxed workspace (default: current directory). Prefer Glob/Grep when you know what you are looking for.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory to list' },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Glob patterns to ignore' },
    },
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => i.path ?? '.',
  async run(input, { ws }) {
    const root = ws.resolve(input.path ?? '.')
    if (!(await ws.isDir(root))) return errorResult(`Not a directory: ${root}`)
    const ignore = input.ignore ?? []
    const lines: string[] = [`- ${root}/`]
    let count = 0
    const visit = async (dir: string, depth: number) => {
      for (const e of await ws.list(dir)) {
        if (count >= 1000) return
        if (ignore.some((g) => minimatch(e.name, g) || minimatch(e.path, g))) continue
        count++
        lines.push(`${'  '.repeat(depth + 1)}- ${e.name}${e.isDir ? '/' : ''}`)
        if (e.isDir && depth < 6) await visit(e.path, depth + 1)
      }
    }
    await visit(root, 0)
    if (count >= 1000) lines.push('… (listing truncated at 1000 entries)')
    if (count === 0) lines.push('  (empty)')
    return { content: lines.join('\n') }
  },
}

export const GlobTool: ToolDef<{ pattern: string; path?: string }> = {
  name: 'Glob',
  description: `Fast file pattern matching over the sandboxed workspace.
- Supports glob patterns like "**/*.js" or "src/**/*.ts".
- Returns matching file paths sorted by modification time (newest first).
- Use it to find files by name; use Grep to search contents.`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
      path: { type: 'string', description: 'Directory to search in (default: current directory)' },
    },
    required: ['pattern'],
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => `${i.pattern}${i.path ? ` en ${i.path}` : ''}`,
  async run(input, { ws }) {
    const root = ws.resolve(input.path ?? '.')
    if (!(await ws.isDir(root))) return errorResult(`Directory does not exist: ${root}`)
    const files = await ws.walk(root)
    const pattern = input.pattern.startsWith('/') ? input.pattern : input.pattern
    const matches = files.filter((f) => {
      const rel = f.path.slice(root === '/' ? 1 : root.length + 1)
      return minimatch(rel, pattern, { dot: true, matchBase: !pattern.includes('/') }) || minimatch(f.path, pattern, { dot: true })
    })
    matches.sort((a, b) => b.mtime - a.mtime)
    if (matches.length === 0) return { content: 'No files found' }
    const shown = matches.slice(0, 100).map((f) => f.path)
    let content = shown.join('\n')
    if (matches.length > 100) content += `\n(Results truncated: ${matches.length} files matched. Use a more specific pattern.)`
    return { content }
  },
}

const TYPE_GLOBS: Record<string, string[]> = {
  js: ['*.js', '*.mjs', '*.cjs', '*.jsx'],
  ts: ['*.ts', '*.tsx', '*.mts', '*.cts'],
  py: ['*.py', '*.pyi'],
  md: ['*.md', '*.markdown'],
  json: ['*.json', '*.jsonl'],
  html: ['*.html', '*.htm'],
  css: ['*.css', '*.scss', '*.less'],
  go: ['*.go'],
  rust: ['*.rs'],
  java: ['*.java'],
  c: ['*.c', '*.h'],
  cpp: ['*.cpp', '*.hpp', '*.cc', '*.hh'],
  sh: ['*.sh', '*.bash'],
  yaml: ['*.yml', '*.yaml'],
  sql: ['*.sql'],
}

export interface GrepInput {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  '-i'?: boolean
  '-n'?: boolean
  '-A'?: number
  '-B'?: number
  '-C'?: number
  head_limit?: number
  offset?: number
  multiline?: boolean
}

export const GrepTool: ToolDef<GrepInput> = {
  name: 'Grep',
  description: `Searches file contents in the sandboxed workspace using JavaScript regular expressions (ripgrep-like).
- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+").
- Filter files with glob (e.g. "*.ts", "**/*.{ts,tsx}") or type (js, ts, py, md, json, html, css, go, rust, java, c, cpp, sh, yaml, sql).
- output_mode: "files_with_matches" (default, file paths), "content" (matching lines, supports -A/-B/-C context and -n line numbers), "count".
- multiline: true lets patterns span lines ("." matches newlines).
- head_limit and offset paginate the results.`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for' },
      path: { type: 'string', description: 'File or directory to search (default: current directory)' },
      glob: { type: 'string', description: 'Glob filter for files' },
      type: { type: 'string', description: 'File type filter' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
      '-i': { type: 'boolean', description: 'Case insensitive' },
      '-n': { type: 'boolean', description: 'Show line numbers (content mode, default true)' },
      '-A': { type: 'number', description: 'Lines of context after each match' },
      '-B': { type: 'number', description: 'Lines of context before each match' },
      '-C': { type: 'number', description: 'Lines of context before and after each match' },
      head_limit: { type: 'number', description: 'Limit the number of output entries' },
      offset: { type: 'number', description: 'Skip the first N entries' },
      multiline: { type: 'boolean', description: 'Allow matches across lines' },
    },
    required: ['pattern'],
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => `/${i.pattern}/${i.path ? ` en ${i.path}` : ''}`,
  async run(input, { ws }) {
    return grep(ws, input)
  },
}

export async function grep(ws: Workspace, input: GrepInput): Promise<ToolResult> {
  let re: RegExp
  try {
    re = new RegExp(input.pattern, `g${input['-i'] ? 'i' : ''}${input.multiline ? 'ms' : ''}`)
  } catch (e) {
    return errorResult(`Invalid regex: ${(e as Error).message}`)
  }
  const target = ws.resolve(input.path ?? '.')
  if (!(await ws.fs.exists(target))) return errorResult(`Path does not exist: ${target}`)
  let files = (await ws.isDir(target)) ? await ws.walk(target) : [await ws.stat(target)]
  const globs = [...(input.glob ? [input.glob] : []), ...(input.type ? (TYPE_GLOBS[input.type] ?? [`*.${input.type}`]) : [])]
  if (input.glob && input.type) {
    files = files.filter((f) => minimatch(f.name, input.glob!, { dot: true, matchBase: true }) || minimatch(f.path, input.glob!, { dot: true }))
    files = files.filter((f) => (TYPE_GLOBS[input.type!] ?? [`*.${input.type}`]).some((g) => minimatch(f.name, g)))
  } else if (globs.length) {
    files = files.filter((f) =>
      globs.some((g) => minimatch(f.name, g, { dot: true }) || minimatch(f.path.slice(target.length + 1), g, { dot: true }) || minimatch(f.path, g, { dot: true })),
    )
  }
  const mode = input.output_mode ?? 'files_with_matches'
  const after = input['-A'] ?? input['-C'] ?? 0
  const before = input['-B'] ?? input['-C'] ?? 0
  const showNums = input['-n'] ?? true
  const entries: string[] = []
  const fileHits: Array<{ path: string; mtime: number }> = []

  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) continue
    const bytes = await ws.readBytes(f.path)
    if (!looksTextual(f.path, bytes)) continue
    const text = new TextDecoder().decode(bytes)
    re.lastIndex = 0
    if (!re.test(text)) continue
    re.lastIndex = 0
    fileHits.push({ path: f.path, mtime: f.mtime })
    if (mode === 'files_with_matches') continue
    const lines = text.split('\n')
    if (mode === 'count') {
      const n = text.match(re)?.length ?? 0
      entries.push(`${f.path}:${n}`)
      continue
    }
    // content
    const hitLines = new Set<number>()
    if (input.multiline) {
      for (const m of text.matchAll(re)) {
        const startLine = text.slice(0, m.index).split('\n').length - 1
        const span = m[0].split('\n').length
        for (let k = 0; k < span; k++) hitLines.add(startLine + k)
      }
    } else {
      const lineRe = new RegExp(input.pattern, input['-i'] ? 'i' : '')
      lines.forEach((l, i) => {
        if (lineRe.test(l)) hitLines.add(i)
      })
    }
    const show = new Set<number>()
    for (const i of hitLines) for (let k = i - before; k <= i + after; k++) if (k >= 0 && k < lines.length) show.add(k)
    const sorted = [...show].sort((a, b) => a - b)
    let prev = -2
    for (const i of sorted) {
      if (prev >= 0 && i > prev + 1 && (before || after)) entries.push('--')
      const sep = hitLines.has(i) ? ':' : '-'
      const line = lines[i].length > 500 ? `${lines[i].slice(0, 500)}…` : lines[i]
      entries.push(showNums ? `${f.path}${sep}${i + 1}${sep}${line}` : `${f.path}${sep}${line}`)
      prev = i
    }
  }

  let out: string[]
  if (mode === 'files_with_matches') out = fileHits.sort((a, b) => b.mtime - a.mtime).map((h) => h.path)
  else out = entries
  const offset = input.offset ?? 0
  const limit = input.head_limit ?? (mode === 'content' ? 500 : 200)
  const page = out.slice(offset, offset + limit)
  if (page.length === 0) return { content: mode === 'count' ? 'No matches found' : 'No matches found' }
  let content = mode === 'files_with_matches' ? `Found ${out.length} file${out.length === 1 ? '' : 's'}\n${page.join('\n')}` : page.join('\n')
  if (out.length > offset + limit) content += `\n(… ${out.length - offset - limit} more results; use offset/head_limit to paginate)`
  return { content }
}

export const NotebookEditTool: ToolDef<{
  notebook_path: string
  cell_id?: string
  new_source: string
  cell_type?: 'code' | 'markdown'
  edit_mode?: 'replace' | 'insert' | 'delete'
}> = {
  name: 'NotebookEdit',
  description: `Edits a Jupyter notebook (.ipynb) cell in the sandboxed workspace.
- cell_id identifies the cell (id from Read output, or "cell-N" for the N-th cell, 0-based).
- edit_mode: "replace" (default) replaces the cell source, "insert" adds a new cell after cell_id (or at the start if omitted; cell_type required), "delete" removes the cell.`,
  inputSchema: {
    type: 'object',
    properties: {
      notebook_path: { type: 'string' },
      cell_id: { type: 'string' },
      new_source: { type: 'string' },
      cell_type: { type: 'string', enum: ['code', 'markdown'] },
      edit_mode: { type: 'string', enum: ['replace', 'insert', 'delete'] },
    },
    required: ['notebook_path', 'new_source'],
  },
  readOnly: false,
  permission: 'edit',
  summarize: (i) => `${i.notebook_path} (${i.edit_mode ?? 'replace'})`,
  matchKey: (i) => i.notebook_path,
  async run(input, { ws }) {
    const p = ws.resolve(input.notebook_path)
    if (!p.endsWith('.ipynb')) return errorResult('notebook_path must be a .ipynb file')
    const stale = await assertFreshRead(ws, p)
    if (stale) return errorResult(stale)
    let nb: { cells: Array<Record<string, unknown>>; [k: string]: unknown }
    try {
      nb = (await ws.fs.exists(p))
        ? JSON.parse(await ws.readText(p))
        : { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }
    } catch {
      return errorResult('The notebook is not valid JSON')
    }
    nb.cells ??= []
    const before = JSON.stringify(nb, null, 1)
    const idx = input.cell_id
      ? nb.cells.findIndex((c, i) => c.id === input.cell_id || `cell-${i}` === input.cell_id)
      : -1
    const mode = input.edit_mode ?? 'replace'
    if (mode !== 'insert' && idx < 0) return errorResult(`Cell not found: ${input.cell_id}`)
    const source = input.new_source.split(/(?<=\n)/)
    if (mode === 'delete') nb.cells.splice(idx, 1)
    else if (mode === 'insert') {
      if (!input.cell_type) return errorResult('cell_type is required for insert')
      const cell: Record<string, unknown> = {
        cell_type: input.cell_type,
        id: Math.random().toString(36).slice(2, 10),
        metadata: {},
        source,
      }
      if (input.cell_type === 'code') Object.assign(cell, { outputs: [], execution_count: null })
      nb.cells.splice(idx + 1, 0, cell)
    } else {
      nb.cells[idx].source = source
      if (input.cell_type) nb.cells[idx].cell_type = input.cell_type
    }
    const after = JSON.stringify(nb, null, 1)
    await ws.writeFile(p, after)
    return { content: `Notebook ${basename(p)} updated (${mode}).`, display: diffDisplay(p, before, after) }
  },
}

export const fileTools = [ReadTool, WriteTool, EditTool, MultiEditTool, LSTool, GlobTool, GrepTool, NotebookEditTool]
export { HOME }
