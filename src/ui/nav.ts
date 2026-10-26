import { FlaskConical, MessagesSquare, Puzzle, Server, Settings, ShieldCheck, Swords, type LucideIcon } from 'lucide-react'
import type { View } from '../state/ui'

export interface NavItem {
  id: View
  label: string
  Icon: LucideIcon
}

export const NAV: NavItem[] = [
  { id: 'chat', label: 'Chat', Icon: MessagesSquare },
  { id: 'arena', label: 'Arena', Icon: Swords },
  { id: 'evals', label: 'Evals', Icon: FlaskConical },
  { id: 'extensions', label: 'Extensiones', Icon: Puzzle },
  { id: 'providers', label: 'Proveedores', Icon: Server },
  { id: 'security', label: 'Seguridad', Icon: ShieldCheck },
]

export const SETTINGS_NAV: NavItem = { id: 'settings', label: 'Ajustes', Icon: Settings }

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}
