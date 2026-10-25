import { Eye, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSettings } from '../../state/settings'
import { useUi } from '../../state/ui'
import { Empty } from '../primitives'

/** Iframe sin allow-same-origin: el contenido no puede leer la app ni sus claves, y su CSP bloquea la red. */
export function PreviewPanel({ sessionId }: { sessionId: string }) {
  const preview = useUi((s) => s.preview)
  const cdn = useSettings((s) => s.previewCdn)
  const frame = useRef<HTMLIFrameElement>(null)
  const current = preview && preview.sessionId === sessionId ? preview : null

  useEffect(() => {
    if (!current) return
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== 'glasshouse:ready') return
      frame.current?.contentWindow?.postMessage({ type: 'glasshouse:render', html: current.html }, '*')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [current])

  if (!current) {
    return (
      <Empty icon={<Eye size={22} />} title="Nada que previsualizar">
        Cuando el modelo use la herramienta Preview, o abras un .html del workspace, se mostrará aquí aislado: sin red y sin acceso a la app.
      </Empty>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-1.5 text-[11px] text-muted">
        <ShieldCheck size={13} className="text-ok" />
        <span className="min-w-0 flex-1 truncate">
          {current.title} · {cdn ? 'CDNs permitidos' : 'sin red'}
        </span>
        <button className="btn btn-ghost btn-icon" onClick={() => useUi.getState().setPreview({ ...current })} aria-label="Recargar">
          <RefreshCw size={13} />
        </button>
      </div>
      <iframe
        key={`${current.version}-${cdn}`}
        ref={frame}
        title="Vista previa aislada"
        src={cdn ? '/sandbox/preview-cdn.html' : '/sandbox/preview-strict.html'}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 bg-white"
      />
    </div>
  )
}
