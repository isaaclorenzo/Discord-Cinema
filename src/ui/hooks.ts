import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Workspace } from '../core/sandbox/workspace'
import { getWorkspace } from '../state/workspaces'

/** Workspace de la sesión + un contador que cambia cuando cambian sus archivos. */
export function useWorkspace(sessionId: string | null): { ws: Workspace | null; version: number } {
  const [ws, setWs] = useState<Workspace | null>(null)
  useEffect(() => {
    let alive = true
    if (!sessionId) return
    void getWorkspace(sessionId).then((w) => alive && setWs(w))
    return () => {
      alive = false
    }
  }, [sessionId])
  const current = ws && ws.id === sessionId ? ws : null
  const version = useSyncExternalStore(
    (cb) => (current ? current.subscribe(cb) : () => {}),
    () => current?.version ?? -1,
  )
  return { ws: current, version }
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}
