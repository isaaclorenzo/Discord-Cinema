import { Cpu } from 'lucide-react'
import { useWebLlm } from '../../core/providers/webllm'

/** Progreso de descarga/carga del modelo local (WebLLM). */
export function LocalModelStatus() {
  const { loading, progress, text } = useWebLlm()
  if (!loading) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-xs text-muted animate-fade-in">
        <Cpu size={15} className="shrink-0 animate-pulse-soft text-cyan" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between gap-2">
            <span className="text-fg/90">Preparando el modelo local (la descarga solo ocurre la primera vez)</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300 transition-all" style={{ width: `${Math.max(2, progress * 100)}%` }} />
          </div>
          <div className="mt-1 truncate text-[11px] text-faint">{text}</div>
        </div>
      </div>
    </div>
  )
}
