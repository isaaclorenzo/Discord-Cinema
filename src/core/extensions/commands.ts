// Expansión de comandos personalizados (formato de Claude Code):
// $ARGUMENTS, $1..$9, @ruta (incluye el archivo) y !`comando` (se ejecuta en
// el bash del sandbox y se sustituye por su salida).

import type { Workspace } from '../sandbox/workspace'
import { truncate } from '../util'
import type { SlashCommand } from './types'

export function parseSlash(input: string): { name: string; args: string } | null {
  const m = input.trim().match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  return { name: m[1], args: (m[2] ?? '').trim() }
}

function splitArgs(args: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const m of args.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

export async function expandCommand(cmd: SlashCommand, args: string, ws: Workspace): Promise<string> {
  const positional = splitArgs(args)
  let text = cmd.template.replaceAll('$ARGUMENTS', args)
  text = text.replace(/\$([1-9])/g, (_, n) => positional[Number(n) - 1] ?? '')

  // !`comando` → salida del comando en el sandbox
  const bang = [...text.matchAll(/!`([^`]+)`/g)]
  for (const m of bang) {
    const r = await ws.exec(m[1])
    text = text.replace(m[0], truncate((r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim(), 20_000))
  }

  // @ruta → contenido del archivo (solo rutas existentes del workspace)
  const refs = [...text.matchAll(/(^|\s)@([\w./-]+)/g)]
  const included: string[] = []
  for (const m of refs) {
    const path = m[2]
    if (included.includes(path)) continue
    try {
      if (await ws.exists(path) && !(await ws.isDir(path))) {
        const content = await ws.readText(path)
        included.push(path)
        text += `\n\n<file path="${ws.resolve(path)}">\n${truncate(content, 50_000)}\n</file>`
      }
    } catch {
      /* se ignora */
    }
  }
  return text.trim()
}
