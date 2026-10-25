// Backends de búsqueda web. Todos pasan por netFetch (guard + inspector) y,
// salvo SearXNG propio, por el relay (las APIs no permiten CORS).

import { netFetch } from '../net'
import type { SearchResult } from '../tools/types'

export type SearchBackendId = 'duckduckgo' | 'brave' | 'tavily' | 'searxng' | 'exa'

export interface SearchConfig {
  backend: SearchBackendId
  apiKey: string
  searxngUrl: string
}

function filterDomains(results: SearchResult[], allowed?: string[], blocked?: string[]): SearchResult[] {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase()
    } catch {
      return ''
    }
  }
  const match = (h: string, d: string) => h === d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`)
  return results.filter((r) => {
    const h = host(r.url)
    if (allowed?.length && !allowed.some((d) => match(h, d))) return false
    if (blocked?.some((d) => match(h, d))) return false
    return true
  })
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

export function parseDuckDuckGo(html: string): SearchResult[] {
  const out: SearchResult[] = []
  const blocks = html.split(/class="result results_links/).slice(1)
  for (const b of blocks) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!a) continue
    let url = a[1].replace(/&amp;/g, '&')
    const uddg = url.match(/[?&]uddg=([^&]+)/)
    if (uddg) url = decodeURIComponent(uddg[1])
    if (url.startsWith('//')) url = `https:${url}`
    if (/duckduckgo\.com\/y\.js/.test(url)) continue // anuncios
    const snip = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
    out.push({ title: decodeEntities(a[2]), url, snippet: snip ? decodeEntities(snip[1]) : '' })
  }
  return out
}

export async function webSearch(
  query: string,
  cfg: SearchConfig,
  opts: { allowed?: string[]; blocked?: string[]; signal: AbortSignal },
): Promise<SearchResult[]> {
  const label = `WebSearch · ${cfg.backend}`
  let results: SearchResult[] = []
  switch (cfg.backend) {
    case 'duckduckgo': {
      const res = await netFetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { method: 'GET', headers: { accept: 'text/html' }, signal: opts.signal },
        { purpose: 'websearch', label, via: 'relay', follow: true },
      )
      if (!res.ok) throw new Error(`DuckDuckGo respondió ${res.status}`)
      results = parseDuckDuckGo(await res.text())
      break
    }
    case 'brave': {
      if (!cfg.apiKey) throw new Error('Falta la clave de Brave Search (Ajustes → Búsqueda web)')
      const res = await netFetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
        { method: 'GET', headers: { accept: 'application/json', 'x-subscription-token': cfg.apiKey }, signal: opts.signal },
        { purpose: 'websearch', label, via: 'relay' },
      )
      if (!res.ok) throw new Error(`Brave respondió ${res.status}`)
      const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } }
      results = (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: decodeEntities(r.description ?? '') }))
      break
    }
    case 'tavily': {
      if (!cfg.apiKey) throw new Error('Falta la clave de Tavily (Ajustes → Búsqueda web)')
      const res = await netFetch(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ query, max_results: 10 }),
          signal: opts.signal,
        },
        { purpose: 'websearch', label, via: 'relay' },
      )
      if (!res.ok) throw new Error(`Tavily respondió ${res.status}`)
      const data = (await res.json()) as { results?: Array<{ title: string; url: string; content?: string }> }
      results = (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }))
      break
    }
    case 'exa': {
      if (!cfg.apiKey) throw new Error('Falta la clave de Exa (Ajustes → Búsqueda web)')
      const res = await netFetch(
        'https://api.exa.ai/search',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey },
          body: JSON.stringify({ query, numResults: 10, contents: { text: { maxCharacters: 400 } } }),
          signal: opts.signal,
        },
        { purpose: 'websearch', label, via: 'relay' },
      )
      if (!res.ok) throw new Error(`Exa respondió ${res.status}`)
      const data = (await res.json()) as { results?: Array<{ title: string; url: string; text?: string }> }
      results = (data.results ?? []).map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: r.text ?? '' }))
      break
    }
    case 'searxng': {
      if (!cfg.searxngUrl) throw new Error('Configura la URL de tu instancia de SearXNG (Ajustes → Búsqueda web)')
      const base = cfg.searxngUrl.replace(/\/+$/, '')
      const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(base)
      const res = await netFetch(
        `${base}/search?q=${encodeURIComponent(query)}&format=json`,
        { method: 'GET', headers: { accept: 'application/json' }, signal: opts.signal },
        { purpose: 'websearch', label, via: local ? 'direct' : 'relay' },
      )
      if (!res.ok) throw new Error(`SearXNG respondió ${res.status}`)
      const data = (await res.json()) as { results?: Array<{ title: string; url: string; content?: string }> }
      results = (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }))
      break
    }
  }
  return filterDomains(results, opts.allowed, opts.blocked).slice(0, 10)
}
