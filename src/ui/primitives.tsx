import { X } from 'lucide-react'
import { useEffect, useId, type ReactNode } from 'react'
import { cx } from './cx'

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <label htmlFor={id} className={cx('flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full border border-white/15 bg-white/10 transition peer-checked:border-violet-300/40 peer-checked:bg-violet-500/60 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-400/60" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white/80 shadow transition peer-checked:translate-x-4 peer-checked:bg-white" />
      </span>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-fg">{label}</span>}
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      )}
    </label>
  )
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6 animate-fade-in" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx('glass-strong flex max-h-[92vh] w-full flex-col rounded-t-3xl sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: ReactNode; icon?: ReactNode; badge?: ReactNode }>; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto rounded-xl bg-black/20 p-1', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
            value === it.id ? 'bg-white/12 text-fg shadow-sm' : 'text-muted hover:bg-white/6 hover:text-fg',
          )}
        >
          {it.icon}
          {it.label}
          {it.badge}
        </button>
      ))}
    </div>
  )
}

export function Section({ title, description, children, actions }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass rounded-[var(--radius-glass)] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-sm font-medium text-fg/90">{title}</p>
      {children && <div className="max-w-sm text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-violet-300"
      style={{ width: size, height: size }}
      aria-label="Cargando"
    />
  )
}

export function PageHeader({ title, subtitle, icon, actions }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="glass grid size-10 shrink-0 place-items-center rounded-2xl text-violet-200">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
