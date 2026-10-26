// Service worker de seguridad de ISC AGENT.
//
// Algunos hostings estáticos (p. ej. GitHub Pages) no permiten configurar
// cabeceras HTTP. Este service worker añade a los workers del sandbox la misma
// Content-Security-Policy que vercel.json, para que el código del modelo no
// pueda usar la red aunque intente saltarse el bloqueo interno (p. ej. con un
// import() dinámico). No guarda nada en caché: solo reenvía y añade cabeceras.

const RULES = [
  [/\/sandbox\/js-[^/]*$/, "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'"],
  [/\/sandbox\/py-[^/]*$/, "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' https://cdn.jsdelivr.net"],
]

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  const rule = RULES.find(([re]) => re.test(url.pathname))
  if (!rule) return
  event.respondWith(
    (async () => {
      const res = await fetch(event.request)
      const headers = new Headers(res.headers)
      headers.set('Content-Security-Policy', rule[1])
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    })(),
  )
})
