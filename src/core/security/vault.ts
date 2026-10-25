// Bóveda de claves: cifra las claves de API con AES-GCM usando una clave
// derivada de una passphrase (PBKDF2-SHA256, 310 000 iteraciones). Sin la
// passphrase, lo guardado en IndexedDB es ilegible.

import { base64ToBytes, bytesToBase64 } from '../util'

export interface VaultBlob {
  v: 1
  salt: string
  iv: string
  data: string
}

const ITERATIONS = 310_000

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSecrets(secrets: Record<string, string>, passphrase: string): Promise<VaultBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const plain = new TextEncoder().encode(JSON.stringify(secrets))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain))
  return { v: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(cipher) }
}

export async function decryptSecrets(blob: VaultBlob, passphrase: string): Promise<Record<string, string>> {
  const key = await deriveKey(passphrase, base64ToBytes(blob.salt))
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(blob.iv) as BufferSource },
      key,
      base64ToBytes(blob.data) as BufferSource,
    )
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>
  } catch {
    throw new Error('Passphrase incorrecta')
  }
}
