// Persistencia local en IndexedDB (nunca sale del navegador).

import { clear, createStore, del, get, keys, set } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

const store = typeof indexedDB !== 'undefined' ? createStore('glasshouse', 'kv') : undefined

const memory = new Map<string, unknown>()

export async function dbGet<T>(key: string): Promise<T | undefined> {
  if (!store) return memory.get(key) as T | undefined
  return get<T>(key, store)
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  if (!store) {
    memory.set(key, value)
    return
  }
  await set(key, value, store)
}

export async function dbDel(key: string): Promise<void> {
  if (!store) {
    memory.delete(key)
    return
  }
  await del(key, store)
}

export async function dbKeys(): Promise<string[]> {
  if (!store) return [...memory.keys()]
  return (await keys(store)).map(String)
}

export async function dbClear(): Promise<void> {
  memory.clear()
  if (store) await clear(store)
}

/** Almacenamiento para zustand/persist sobre IndexedDB. */
export const idbStorage: StateStorage = {
  getItem: async (name) => (await dbGet<string>(name)) ?? null,
  setItem: async (name, value) => dbSet(name, value),
  removeItem: async (name) => dbDel(name),
}

/** Guardado con retardo por clave (agrupa ráfagas de cambios). */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
export function debouncedSave(key: string, produce: () => unknown | Promise<unknown>, ms = 600): void {
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(async () => {
      timers.delete(key)
      try {
        await dbSet(key, await produce())
      } catch (e) {
        console.error('[isc-agent] no se pudo guardar', key, e)
      }
    }, ms),
  )
}
