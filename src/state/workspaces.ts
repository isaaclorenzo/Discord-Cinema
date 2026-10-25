// Un workspace aislado por sesión, persistido como instantánea en IndexedDB.

import { Workspace, type SnapshotEntry } from '../core/sandbox/workspace'
import { dbGet, debouncedSave } from '../core/storage/db'

const cache = new Map<string, Promise<Workspace>>()

export function getWorkspace(sessionId: string): Promise<Workspace> {
  let p = cache.get(sessionId)
  if (!p) {
    p = (async () => {
      const snap = await dbGet<SnapshotEntry[]>(`ws:${sessionId}`)
      const ws = await Workspace.create(sessionId, snap)
      ws.subscribe(() => debouncedSave(`ws:${sessionId}`, () => ws.snapshot(), 1000))
      return ws
    })()
    cache.set(sessionId, p)
  }
  return p
}

/** Crea un workspace temporal (Arena, Evals) que no se guarda. */
export async function ephemeralWorkspace(id: string, from?: Workspace, files?: Record<string, string>): Promise<Workspace> {
  const ws = from ? await from.clone(id) : await Workspace.create(id)
  for (const [path, content] of Object.entries(files ?? {})) await ws.writeFile(path, content, { silent: true })
  ws.readState.clear()
  return ws
}

export function forgetWorkspace(sessionId: string): void {
  cache.delete(sessionId)
}
