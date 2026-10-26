import { KeyRound, Lock } from 'lucide-react'
import { useState } from 'react'
import { useSecrets } from '../state/secrets'
import { Modal } from './primitives'

/** Pide la passphrase al abrir la app si hay una bóveda de claves guardada. */
export function VaultUnlock() {
  const { ready, vaultExists, unlocked } = useSecrets()
  const [dismissed, setDismissed] = useState(false)
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const open = ready && vaultExists && !unlocked && !dismissed

  const unlock = async () => {
    setBusy(true)
    setError(null)
    try {
      await useSecrets.getState().unlock(pass)
      setPass('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => setDismissed(true)}
      title={
        <span className="flex items-center gap-2">
          <Lock size={16} className="text-sky-200" /> Desbloquear tus claves
        </span>
      }
      footer={
        <>
          <button className="btn" onClick={() => setDismissed(true)}>
            Seguir sin claves
          </button>
          <button className="btn btn-primary" onClick={unlock} disabled={busy || !pass}>
            <KeyRound size={14} /> Desbloquear
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">Tus claves de API están cifradas en este navegador. Escribe tu passphrase para usarlas en esta sesión.</p>
      <input
        className="input mt-3"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && pass && void unlock()}
        placeholder="Passphrase"
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Modal>
  )
}
