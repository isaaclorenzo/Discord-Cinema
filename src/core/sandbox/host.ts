// Rutas de los recursos estáticos (respetan la base de Vite, p. ej.
// /Discord-Cinema/ en GitHub Pages) y service worker que aplica la CSP de los
// sandboxes cuando el hosting no permite cabeceras propias.

export const BASE_URL = import.meta.env.BASE_URL || '/'

export function assetUrl(path: string): string {
  return `${BASE_URL}${path.replace(/^\/+/, '')}`
}

let ready: Promise<void> | null = null

function swSupported(): boolean {
  return import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

export function registerSandboxServiceWorker(): void {
  if (!swSupported()) return
  ready = (async () => {
    try {
      await navigator.serviceWorker.register(assetUrl('sw.js'), { scope: BASE_URL })
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 4000)
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(t)
            resolve()
          }, { once: true })
        })
      }
    } catch (e) {
      console.warn('[glasshouse] no se pudo registrar el service worker de seguridad', e)
    }
  })()
}

/** Espera a que el service worker controle la página antes de crear workers. */
export function sandboxReady(): Promise<void> {
  return ready ?? Promise.resolve()
}
