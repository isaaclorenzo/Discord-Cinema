import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { dbDel, dbGet, debouncedSave, idbStorage } from '../core/storage/db'
import type { ChatMessage, PermissionMode, TodoItem } from '../core/types'
import { uid } from '../core/util'

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  modelRef: string
  todos: TodoItem[]
  /** Modo de permisos propio (si no, el global). */
  mode?: PermissionMode
  costUsd?: number
  tokens?: number
}

interface SessionsState {
  sessions: Session[]
  currentId: string | null
  messages: Record<string, ChatMessage[]>
  loaded: Record<string, boolean>
  running: Record<string, boolean>

  newSession: (modelRef: string, title?: string) => string
  select: (id: string) => void
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  patch: (id: string, patch: Partial<Session>) => void
  load: (id: string) => Promise<void>
  push: (id: string, m: ChatMessage) => void
  update: (id: string, msgId: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage)) => void
  setMessages: (id: string, messages: ChatMessage[]) => void
  setRunning: (id: string, running: boolean) => void
}

function saveMessages(id: string) {
  debouncedSave(`msgs:${id}`, () => useSessions.getState().messages[id] ?? [], 500)
}

export const useSessions = create<SessionsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentId: null,
      messages: {},
      loaded: {},
      running: {},

      newSession(modelRef, title = 'Nueva conversación') {
        const id = uid('s')
        const now = Date.now()
        set((s) => ({
          sessions: [{ id, title, createdAt: now, updatedAt: now, modelRef, todos: [] }, ...s.sessions],
          currentId: id,
          messages: { ...s.messages, [id]: [] },
          loaded: { ...s.loaded, [id]: true },
        }))
        return id
      },
      select(id) {
        set({ currentId: id })
        void get().load(id)
      },
      rename(id, title) {
        get().patch(id, { title })
      },
      remove(id) {
        set((s) => {
          const messages = { ...s.messages }
          delete messages[id]
          const sessions = s.sessions.filter((x) => x.id !== id)
          return { sessions, messages, currentId: s.currentId === id ? (sessions[0]?.id ?? null) : s.currentId }
        })
        void dbDel(`msgs:${id}`)
        void dbDel(`ws:${id}`)
      },
      patch(id, patch) {
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x)) }))
      },
      async load(id) {
        if (get().loaded[id]) return
        const msgs = (await dbGet<ChatMessage[]>(`msgs:${id}`)) ?? []
        // Una herramienta que quedó "en curso" al cerrar la pestaña ya no lo está.
        const fixed = msgs.map((m) => (m.status === 'running' || m.status === 'awaiting' ? { ...m, status: 'denied' as const, content: m.content || 'Interrupted.' } : m))
        set((s) => ({ messages: { ...s.messages, [id]: fixed }, loaded: { ...s.loaded, [id]: true } }))
      },
      push(id, m) {
        set((s) => ({ messages: { ...s.messages, [id]: [...(s.messages[id] ?? []), m] } }))
        saveMessages(id)
      },
      update(id, msgId, patch) {
        set((s) => {
          const list = s.messages[id]
          if (!list) return s
          const i = list.findIndex((m) => m.id === msgId)
          if (i < 0) return s
          const next = list.slice()
          next[i] = typeof patch === 'function' ? patch(list[i]) : { ...list[i], ...patch }
          return { messages: { ...s.messages, [id]: next } }
        })
        saveMessages(id)
      },
      setMessages(id, messages) {
        set((s) => ({ messages: { ...s.messages, [id]: messages } }))
        saveMessages(id)
      },
      setRunning(id, running) {
        set((s) => ({ running: { ...s.running, [id]: running } }))
      },
    }),
    {
      name: 'gh-sessions',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ sessions: s.sessions, currentId: s.currentId }),
    },
  ),
)
