import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import vercel from '../vercel.json'

// La CSP de los sandboxes se define en vercel.json (cabeceras), en el service
// worker (hostings sin cabeceras, como GitHub Pages) y en el plugin de Vite.
// Este test evita que se desincronicen.
describe('CSP de los sandboxes', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  const csp = (source: string) =>
    (vercel.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>)
      .find((h) => h.source === source)!
      .headers.find((h) => h.key === 'Content-Security-Policy')!.value

  it('el service worker usa la misma CSP que vercel.json', () => {
    expect(sw).toContain(`"${csp('/sandbox/js-(.*)')}"`)
    expect(sw).toContain(`"${csp('/sandbox/py-(.*)')}"`)
  })

  it('las páginas de preview declaran la misma CSP en su meta', () => {
    for (const f of ['strict', 'cdn']) {
      const html = readFileSync(new URL(`../public/sandbox/preview-${f}.html`, import.meta.url), 'utf8')
      expect(html).toContain(csp(`/sandbox/preview-${f}.html`))
    }
  })
})
