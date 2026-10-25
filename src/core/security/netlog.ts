// Registro de todo el tráfico saliente (inspector de red).

import { create } from 'zustand'
import { uid } from '../util'

export type NetPurpose = 'llm' | 'models' | 'webfetch' | 'websearch' | 'mcp' | 'plugin' | 'install'

export interface NetEntry {
  id: string
  at: number
  purpose: NetPurpose
  label: string
  method: string
  url: string
  via: 'direct' | 'relay'
  requestBytes: number
  requestBody?: string
  status?: number
  durationMs?: number
  error?: string
  redactions: number
  blocked?: boolean
}

const MAX_ENTRIES = 400
const MAX_BODY = 200_000

interface NetlogState {
  entries: NetEntry[]
  add(e: Omit<NetEntry, 'id' | 'at'>): string
  update(id: string, patch: Partial<NetEntry>): void
  clear(): void
}

export const useNetlog = create<NetlogState>((set) => ({
  entries: [],
  add(e) {
    const id = uid('net')
    const entry: NetEntry = {
      ...e,
      id,
      at: Date.now(),
      requestBody: e.requestBody && e.requestBody.length > MAX_BODY ? `${e.requestBody.slice(0, MAX_BODY)}\n… [truncado]` : e.requestBody,
    }
    set((s) => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }))
    return id
  },
  update(id, patch) {
    set((s) => ({ entries: s.entries.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  },
  clear() {
    set({ entries: [] })
  },
}))
