// Formato SKILL.md (compatible con Claude Code): frontmatter YAML con name,
// description y opcionalmente allowed-tools, seguido de las instrucciones.

import { parse as parseYaml } from 'yaml'
import type { Workspace } from '../sandbox/workspace'
import type { ExtSource, Skill } from './types'

export interface Frontmatter {
  data: Record<string, unknown>
  body: string
}

export function parseFrontmatter(text: string): Frontmatter {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: text }
  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(m[1])
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    data = looseFrontmatter(m[1])
  }
  return { data, body: m[2] }
}

/**
 * Frontmatter "clave: valor" línea a línea. Muchos SKILL.md reales tienen
 * descripciones con ": " sin comillas, que no son YAML válido.
 */
function looseFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let last: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (kv) {
      last = kv[1]
      out[last] = kv[2].replace(/^(["'])(.*)\1$/, '$2')
    } else if (last && /^\s+\S/.test(line)) {
      out[last] = `${out[last]} ${line.trim()}`.trim()
    }
  }
  return out
}

function toList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return undefined
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9:._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'skill'
  )
}

export function parseSkillMd(text: string, opts: { source: ExtSource; fallbackName?: string; files?: Record<string, string>; idPrefix?: string }): Skill {
  const { data, body } = parseFrontmatter(text)
  const name = slugify(String(data.name ?? opts.fallbackName ?? 'skill'))
  const description = String(data.description ?? '').trim() || body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 200) || name
  return {
    id: `${opts.idPrefix ?? opts.source}:skill:${name}`,
    name,
    description,
    body: body.trim(),
    allowedTools: toList(data['allowed-tools'] ?? data.allowedTools),
    files: opts.files ?? {},
    source: opts.source,
    enabled: true,
  }
}

export function skillToMarkdown(s: Skill): string {
  const fm = [`name: ${s.name}`, `description: ${JSON.stringify(s.description)}`]
  if (s.allowedTools?.length) fm.push(`allowed-tools: ${s.allowedTools.join(', ')}`)
  return `---\n${fm.join('\n')}\n---\n\n${s.body}\n`
}

/** Carga una skill para el modelo: monta sus archivos y devuelve las instrucciones. */
export async function loadSkillForModel(skill: Skill, ws: Workspace, args?: string): Promise<string> {
  const base = `/skills/${skill.name}`
  if (Object.keys(skill.files).length) await ws.mountFiles(base, skill.files)
  const fileList = Object.keys(skill.files)
  return `<skill name="${skill.name}" base_dir="${base}">
${skill.body}
</skill>
${fileList.length ? `\nSupporting files are available under ${base}/ (read them with Read when the instructions reference them): ${fileList.join(', ')}` : ''}${args ? `\n\nSkill arguments: ${args}` : ''}${skill.allowedTools?.length ? `\n\nThis skill is meant to use only these tools: ${skill.allowedTools.join(', ')}.` : ''}

Follow the skill instructions above for the current task.`
}
