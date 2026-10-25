import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useUi } from '../state/ui'
import { cx } from './cx'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('glass-strong pointer-events-auto flex items-start gap-2 rounded-2xl px-4 py-3 text-sm animate-fade-in', t.kind === 'error' && 'border-rose-300/30')}>
          {t.kind === 'error' ? <TriangleAlert size={16} className="mt-0.5 shrink-0 text-rose-300" /> : t.kind === 'success' ? <CircleCheck size={16} className="mt-0.5 shrink-0 text-ok" /> : <Info size={16} className="mt-0.5 shrink-0 text-cyan" />}
          <span className="min-w-0 flex-1">{t.text}</span>
          <button className="text-faint hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
