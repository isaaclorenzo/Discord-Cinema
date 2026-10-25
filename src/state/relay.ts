// Estado del relay: ¿existe en este despliegue y acepta nuestro token?

import { create } from 'zustand'
import { assetUrl } from '../core/sandbox/host'

export type RelayStatus = 'checking' | 'ok' | 'needs-token' | 'disabled' | 'missing'

export const relayState: { status: RelayStatus } = { status: 'checking' }

interface RelayStore {
  status: RelayStatus
  message: string
  check: (url: string, token: string) => Promise<RelayStatus>
}

export function defaultRelayUrl(): string {
  return assetUrl('api/relay')
}

export const useRelay = create<RelayStore>((set) => ({
  status: 'checking',
  message: '',
  async check(url, token) {
    set({ status: 'checking', message: '' })
    let status: RelayStatus = 'missing'
    let message = 'No hay relay en esta dirección.'
    try {
      const res = await fetch(url || defaultRelayUrl(), { headers: token ? { 'x-harness-token': token } : {}, credentials: 'omit' })
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('application/json')) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (res.status === 400) {
          status = 'ok'
          message = 'Relay disponible.'
        } else if (res.status === 401) {
          status = 'needs-token'
          message = 'El relay existe pero el token no es válido o falta.'
        } else if (res.status === 503) {
          status = 'disabled'
          message = body.error ?? 'El relay está desactivado (falta HARNESS_ACCESS_TOKEN en el servidor).'
        }
      }
    } catch {
      status = 'missing'
      message = 'No se pudo contactar con el relay (no existe o no permite CORS desde este origen).'
    }
    relayState.status = status
    set({ status, message })
    return status
  },
}))
