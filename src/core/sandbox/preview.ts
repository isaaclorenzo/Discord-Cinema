// Construye un documento HTML autocontenido para la vista previa aislada:
// los CSS/JS/imágenes locales del workspace se incrustan, porque el iframe no
// tiene red ni acceso al origen de la app.

import type { Workspace } from './workspace'
import { bytesToBase64, imageMediaType } from '../util'

const REMOTE = /^(https?:)?\/\//i

function resolveRel(base: string, rel: string): string {
  if (rel.startsWith('/')) return rel
  const dir = base.slice(0, base.lastIndexOf('/'))
  return `${dir}/${rel}`
}

export async function buildPreviewHtml(ws: Workspace, path: string): Promise<string> {
  const file = ws.resolve(path)
  let html = await ws.readText(file)

  const replaceAsync = async (re: RegExp, fn: (m: RegExpMatchArray) => Promise<string>) => {
    const matches = [...html.matchAll(re)]
    for (const m of matches) html = html.replace(m[0], await fn(m))
  }

  await replaceAsync(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, async (m) => {
    const href = m[0].match(/href=["']([^"']+)["']/i)?.[1]
    if (!href || REMOTE.test(href) || href.startsWith('data:')) return m[0]
    try {
      return `<style data-from="${href}">\n${await ws.readText(resolveRel(file, href.split('?')[0]))}\n</style>`
    } catch {
      return m[0]
    }
  })

  await replaceAsync(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, async (m) => {
    const src = m[2]
    if (REMOTE.test(src) || src.startsWith('data:')) return m[0]
    try {
      const code = (await ws.readText(resolveRel(file, src.split('?')[0]))).replace(/<\/script/gi, '<\\/script')
      return `<script${m[1]}${m[3]}>\n${code}\n</script>`
    } catch {
      return m[0]
    }
  })

  await replaceAsync(/\b(src|href)=["']([^"']+\.(?:png|jpe?g|gif|webp|svg))["']/gi, async (m) => {
    const ref = m[2]
    if (REMOTE.test(ref) || ref.startsWith('data:')) return m[0]
    try {
      const p = resolveRel(file, ref)
      const bytes = await ws.readBytes(p)
      const mt = ref.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : (imageMediaType(p) ?? 'application/octet-stream')
      return `${m[1]}="data:${mt};base64,${bytesToBase64(bytes)}"`
    } catch {
      return m[0]
    }
  })
  return html
}
