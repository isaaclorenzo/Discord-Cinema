import { Check, ChevronDown, Cpu, Shield, ShieldOff, ClipboardList, FilePen } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MODE_LABELS, MODE_ORDER } from '../../core/agent/permissions'
import type { PermissionMode } from '../../core/types'
import { useSecrets } from '../../state/secrets'
import { useSettings } from '../../state/settings'
import { useUi } from '../../state/ui'
import { cx } from '../cx'

function Popover({ trigger, children, align = 'left', up = true }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div className={cx('glass-strong absolute z-40 max-h-[60vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-1.5 animate-fade-in', up ? 'bottom-full mb-2' : 'top-full mt-2', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function ModelPicker({ value, onChange, up = true }: { value: string; onChange: (ref: string) => void; up?: boolean }) {
  const providers = useSettings((s) => s.providers)
  const keys = useSecrets((s) => s.keys)
  const current = providers.flatMap((p) => p.models.map((m) => ({ p, m }))).find(({ p, m }) => `${p.id}::${m.id}` === value)
  return (
    <Popover
      up={up}
      trigger={(open, toggle) => (
        <button className="btn max-w-[14rem] px-2.5 py-1.5 text-xs" onClick={toggle} aria-expanded={open} aria-haspopup="listbox">
          <Cpu size={13} className="shrink-0 text-violet-200" />
          <span className="truncate">{current ? (current.m.label ?? current.m.id) : 'Elegir modelo'}</span>
          <ChevronDown size={12} className="shrink-0 text-muted" />
        </button>
      )}
    >
      {(close) => (
        <div role="listbox">
          {providers
            .filter((p) => p.enabled)
            .map((p) => (
              <div key={p.id} className="mb-1">
                <div className="flex items-center justify-between px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  {p.name}
                  {p.kind !== 'mock' && p.kind !== 'webllm' && !keys[p.id] && !/localhost|127\.0\.0\.1/.test(p.baseUrl) && <span className="normal-case text-amber/80">sin clave</span>}
                </div>
                {p.models.length === 0 && <div className="px-2.5 py-1 text-xs text-muted">Carga los modelos en Proveedores</div>}
                {p.models.map((m) => {
                  const ref = `${p.id}::${m.id}`
                  return (
                    <button
                      key={ref}
                      role="option"
                      aria-selected={ref === value}
                      className={cx('flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] hover:bg-white/8', ref === value && 'bg-white/10')}
                      onClick={() => {
                        onChange(ref)
                        close()
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{m.label ?? m.id}</span>
                      {m.sizeMB ? <span className="chip">{(m.sizeMB / 1024).toFixed(1)} GB</span> : m.toolMode === 'prompt' && <span className="chip">tools por prompt</span>}
                      {m.vision && <span className="chip">visión</span>}
                      {ref === value && <Check size={13} className="text-violet-200" />}
                    </button>
                  )
                })}
              </div>
            ))}
          <button
            className="mt-1 w-full rounded-xl px-2.5 py-2 text-left text-xs text-violet-200 hover:bg-white/8"
            onClick={() => {
              useUi.getState().setView('providers')
              close()
            }}
          >
            + Añadir proveedor o modelos
          </button>
        </div>
      )}
    </Popover>
  )
}

const MODE_ICONS: Record<PermissionMode, ReactNode> = {
  default: <Shield size={13} />,
  acceptEdits: <FilePen size={13} />,
  plan: <ClipboardList size={13} />,
  bypassPermissions: <ShieldOff size={13} />,
}

export function ModePicker({ value, onChange }: { value: PermissionMode; onChange: (m: PermissionMode) => void }) {
  return (
    <Popover
      trigger={(open, toggle) => (
        <button
          className={cx('btn px-2.5 py-1.5 text-xs', value === 'bypassPermissions' && 'border-rose-300/30 text-rose-100', value === 'plan' && 'border-cyan-300/30 text-cyan-100')}
          onClick={toggle}
          aria-expanded={open}
          title="Modo de permisos (Shift+Tab)"
        >
          {MODE_ICONS[value]}
          <span className="hidden sm:inline">{MODE_LABELS[value].label}</span>
        </button>
      )}
    >
      {(close) =>
        MODE_ORDER.map((m) => (
          <button
            key={m}
            className={cx('flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-white/8', m === value && 'bg-white/10')}
            onClick={() => {
              onChange(m)
              close()
            }}
          >
            <span className={cx('mt-0.5', m === 'bypassPermissions' ? 'text-rose-300' : 'text-violet-200')}>{MODE_ICONS[m]}</span>
            <span>
              <span className="block text-[13px] font-medium">{MODE_LABELS[m].label}</span>
              <span className="block text-xs text-muted">{MODE_LABELS[m].hint}</span>
            </span>
          </button>
        ))
      }
    </Popover>
  )
}
