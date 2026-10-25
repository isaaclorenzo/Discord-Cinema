// Claves de API y tokens. Por defecto solo en memoria (se pierden al cerrar la
// pestaña). Con la bóveda activada se guardan cifradas con una passphrase.

import { create } from 'zustand'
import { dbDel, dbGet, dbSet } from '../core/storage/db'
import { decryptSecrets, encryptSecrets, type VaultBlob } from '../core/security/vault'

const VAULT_KEY = 'gh-vault'

interface SecretsState {
  keys: Record<string, string>
  vaultExists: boolean
  unlocked: boolean
  passphrase: string | null
  ready: boolean
  init: () => Promise<void>
  setKey: (id: string, value: string) => void
  getKey: (id: string) => string
  createVault: (passphrase: string) => Promise<void>
  unlock: (passphrase: string) => Promise<void>
  lock: () => void
  destroyVault: () => Promise<void>
}

async function persistVault(keys: Record<string, string>, passphrase: string | null) {
  if (!passphrase) return
  await dbSet(VAULT_KEY, await encryptSecrets(keys, passphrase))
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useSecrets = create<SecretsState>((set, get) => ({
  keys: {},
  vaultExists: false,
  unlocked: false,
  passphrase: null,
  ready: false,
  async init() {
    const blob = await dbGet<VaultBlob>(VAULT_KEY)
    set({ vaultExists: !!blob, ready: true })
  },
  setKey(id, value) {
    const keys = { ...get().keys, [id]: value }
    if (!value) delete keys[id]
    set({ keys })
    const { passphrase } = get()
    if (passphrase) {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => persistVault(get().keys, get().passphrase), 400)
    }
  },
  getKey: (id) => get().keys[id] ?? '',
  async createVault(passphrase) {
    if (passphrase.length < 8) throw new Error('Usa una passphrase de al menos 8 caracteres')
    await persistVault(get().keys, passphrase)
    set({ vaultExists: true, unlocked: true, passphrase })
  },
  async unlock(passphrase) {
    const blob = await dbGet<VaultBlob>(VAULT_KEY)
    if (!blob) throw new Error('No hay bóveda guardada')
    const stored = await decryptSecrets(blob, passphrase)
    set({ keys: { ...stored, ...get().keys }, unlocked: true, passphrase })
  },
  lock() {
    set({ keys: {}, unlocked: false, passphrase: null })
  },
  async destroyVault() {
    await dbDel(VAULT_KEY)
    set({ vaultExists: false, unlocked: false, passphrase: null })
  },
}))
