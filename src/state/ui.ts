import { create } from 'zustand'
import type { PermissionAnswer, PermissionRequest } from '../core/agent/loop'
import type { Question } from '../core/tools/types'
import { uid } from '../core/util'

export type View = 'chat' | 'arena' | 'evals' | 'extensions' | 'providers' | 'security' | 'settings'

export type Interaction =
  | { id: string; kind: 'permission'; sessionId: string; req: PermissionRequest; resolve: (a: PermissionAnswer) => void }
  | { id: string; kind: 'questions'; sessionId: string; questions: Question[]; resolve: (a: Record<string, string>) => void }
  | { id: string; kind: 'plan'; sessionId: string; plan: string; resolve: (a: { approved: boolean; feedback?: string }) => void }

export interface PreviewState {
  sessionId: string
  title: string
  html: string
  path?: string
  version: number
}

export interface Toast {
  id: string
  kind: 'info' | 'error' | 'success'
  text: string
}

interface UiState {
  view: View
  interactions: Interaction[]
  preview: PreviewState | null
  toasts: Toast[]
  paletteOpen: boolean
  mobilePanel: 'none' | 'sidebar' | 'right'
  openFile: string | null
  setView: (v: View) => void
  addInteraction: (i: Interaction) => void
  resolveInteraction: (id: string) => void
  setPreview: (p: Omit<PreviewState, 'version'> | null) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
  setPalette: (open: boolean) => void
  setMobilePanel: (p: UiState['mobilePanel']) => void
  setOpenFile: (path: string | null) => void
}

export const useUi = create<UiState>((set) => ({
  view: 'chat',
  interactions: [],
  preview: null,
  toasts: [],
  paletteOpen: false,
  mobilePanel: 'none',
  openFile: null,
  setView: (view) => set({ view, mobilePanel: 'none' }),
  addInteraction: (i) => set((s) => ({ interactions: [...s.interactions, i] })),
  resolveInteraction: (id) => set((s) => ({ interactions: s.interactions.filter((i) => i.id !== id) })),
  setPreview: (p) => set((s) => ({ preview: p ? { ...p, version: (s.preview?.version ?? 0) + 1 } : null })),
  toast: (text, kind = 'info') => {
    const id = uid('t')
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),
  setOpenFile: (openFile) => set({ openFile }),
}))
