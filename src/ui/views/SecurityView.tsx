import { KeyRound, Lock, Network, ShieldAlert, ShieldCheck, Trash2, Unlock, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DETECTORS, maskValue, redactText, scanText, type GuardAction } from '../../core/security/guard'
import { useNetlog } from '../../core/security/netlog'
import { dbClear } from '../../core/storage/db'
import { useSecrets } from '../../state/secrets'
import { useSettings } from '../../state/settings'
import { useUi } from '../../state/ui'
import { cx } from '../cx'
import { Field, PageHeader, PageShell, Section, Toggle } from '../primitives'
import { NetworkPanel } from '../panels/NetworkPanel'

const ACTIONS: Array<{ id: GuardAction; label: string; hint: string }> = [
  { id: 'block', label: 'Bloquear', hint: 'Detiene el envío y te pregunta qué hacer (recomendado).' },
  { id: 'redact', label: 'Redactar', hint: 'Sustituye lo detectado por [REDACTED:tipo] y envía.' },
  { id: 'warn', label: 'Solo avisar', hint: 'Envía igualmente; lo verás en el inspector.' },
  { id: 'off', label: 'Apagado', hint: 'No analiza nada. No recomendado con proveedores no fiables.' },
]

function TermList({ field, label, placeholder }: { field: 'customTerms' | 'allowList'; label: string; placeholder: string }) {
  const values = useSettings((s) => s.guard[field])
  const [draft, setDraft] = useState('')
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="chip">
            {v}
            <button aria-label={`Quitar ${v}`} onClick={() => useSettings.getState().setGuard({ [field]: values.filter((x) => x !== v) })}>
              <X size={11} />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-faint">Ninguno</span>}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const v = draft.trim()
          if (v && !values.includes(v)) useSettings.getState().setGuard({ [field]: [...values, v] })
          setDraft('')
        }}
      >
        <input className="input py-1.5 text-xs" placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn px-2.5 text-xs" type="submit">
          Añadir
        </button>
      </form>
    </div>
  )
}

function Vault() {
  const { vaultExists, unlocked, keys } = useSecrets()
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      setPass('')
      useUi.getState().toast(ok, 'success')
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title="Bóveda de claves"
      description="Sin bóveda, las claves de API solo viven en memoria y desaparecen al cerrar la pestaña. Con bóveda, se guardan cifradas (AES-256-GCM, clave derivada con PBKDF2 de 310 000 iteraciones). Sin tu passphrase nadie puede leerlas."
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {unlocked ? <Unlock size={16} className="text-ok" /> : <Lock size={16} className="text-muted" />}
        <span>{vaultExists ? (unlocked ? 'Bóveda desbloqueada' : 'Bóveda bloqueada') : 'Sin bóveda'}</span>
        <span className="chip">{Object.keys(keys).length} claves en memoria</span>
      </div>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!vaultExists) void run(() => useSecrets.getState().createVault(pass), 'Bóveda creada: tus claves se guardan cifradas')
          else if (!unlocked) void run(() => useSecrets.getState().unlock(pass), 'Bóveda desbloqueada')
        }}
      >
        {!unlocked && (
          <>
            <input className="input" type="password" autoComplete={vaultExists ? 'current-password' : 'new-password'} placeholder={vaultExists ? 'Passphrase' : 'Elige una passphrase (mín. 8 caracteres)'} value={pass} onChange={(e) => setPass(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || pass.length < (vaultExists ? 1 : 8)} type="submit">
              <KeyRound size={14} /> {vaultExists ? 'Desbloquear' : 'Crear bóveda'}
            </button>
          </>
        )}
        {unlocked && (
          <button type="button" className="btn" onClick={() => useSecrets.getState().lock()}>
            <Lock size={14} /> Bloquear ahora
          </button>
        )}
        {vaultExists && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (confirm('¿Borrar la bóveda? Las claves guardadas se perderán.')) void run(() => useSecrets.getState().destroyVault(), 'Bóveda borrada')
            }}
          >
            <Trash2 size={14} /> Borrar bóveda
          </button>
        )}
      </form>
    </Section>
  )
}

export function SecurityView() {
  const guard = useSettings((s) => s.guard)
  const setGuard = useSettings((s) => s.setGuard)
  const relayToken = useSecrets((s) => s.keys.relay ?? '')
  const netCount = useNetlog((s) => s.entries.length)
  const [sample, setSample] = useState('Mi email es ana.garcia@empresa.es y mi clave sk-proj-AbCdEf1234567890XyZ, tarjeta 4111 1111 1111 1111.')
  const findings = useMemo(() => scanText(sample, guard), [sample, guard])
  const redacted = useMemo(() => redactText(sample, guard).text, [sample, guard])

  const panic = async () => {
    if (!confirm('Esto borra TODAS las conversaciones, workspaces, extensiones, ajustes y la bóveda de este navegador. ¿Continuar?')) return
    await dbClear()
    useSecrets.getState().lock()
    localStorage.clear()
    sessionStorage.clear()
    location.reload()
  }

  return (
    <PageShell>
      <PageHeader icon={<ShieldCheck size={18} />} title="Seguridad y privacidad" subtitle="Cómo protege Glasshouse tus datos frente a modelos y proveedores en los que no confías." />
      <div className="space-y-4">
        <Section title="Modelo de amenazas" description="Lo que la harness garantiza y lo que no.">
          <ul className="grid gap-2 text-[13px] text-fg/85 sm:grid-cols-2">
            {[
              ['El modelo no toca tu equipo', 'Bash, Python y JS corren en un sandbox del navegador sobre un sistema de archivos virtual.'],
              ['El código no tiene red', 'Los workers anulan fetch, XHR y WebSocket, y tienen su propia CSP. Solo WebFetch, WebSearch y MCP salen, y siempre con permiso.'],
              ['Revisas todo lo que sale', 'El escudo analiza cada envío y el inspector muestra el cuerpo exacto que recibe cada proveedor.'],
              ['La salida del modelo es hostil', 'Markdown sin HTML, imágenes remotas bloqueadas, enlaces con confirmación y previews en iframes aislados.'],
              ['Lo que envías, el proveedor lo ve', 'El escudo detecta patrones conocidos, pero no entiende el contexto: no pegues datos sensibles.'],
              ['Tu navegador es la frontera', 'Una extensión maliciosa o un equipo comprometido quedan fuera de lo que la harness puede proteger.'],
            ].map(([t, d], i) => (
              <li key={t} className="glass-inset rounded-xl p-3">
                <div className={cx('flex items-center gap-2 font-medium', i >= 4 ? 'text-amber-100' : 'text-fg')}>
                  {i >= 4 ? <ShieldAlert size={14} className="text-amber" /> : <ShieldCheck size={14} className="text-ok" />} {t}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Escudo de privacidad" description="Se aplica a mensajes, resultados de herramientas y system prompt antes de cada llamada al modelo, y a cada petición web, MCP o de plugin (incluida la URL).">
          <div className="grid gap-2 sm:grid-cols-4">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                onClick={() => setGuard({ action: a.id })}
                className={cx('rounded-xl border p-3 text-left transition', guard.action === a.id ? 'border-violet-300/50 bg-violet-500/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]')}
              >
                <div className="text-sm font-medium">{a.label}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-muted">{a.hint}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {DETECTORS.map((d) => (
              <Toggle key={d.id} checked={guard.detectors[d.id] ?? d.defaultOn} onChange={(v) => setGuard({ detectors: { ...guard.detectors, [d.id]: v } })} label={d.label} />
            ))}
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <TermList field="customTerms" label="Términos propios (tu nombre, empresa, dirección…)" placeholder="p. ej. Acme Corp" />
            <TermList field="allowList" label="Valores permitidos (no se marcan)" placeholder="p. ej. demo@example.com" />
          </div>
          <div className="mt-5">
            <Field label="Prueba el escudo">
              <textarea className="input min-h-20 text-xs" value={sample} onChange={(e) => setSample(e.target.value)} />
            </Field>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {findings.map((f, i) => (
                <span key={i} className="chip text-amber">
                  {f.label}: <code className="font-mono">{maskValue(f.value)}</code>
                </span>
              ))}
              {findings.length === 0 && <span className="chip text-ok">Nada detectado</span>}
            </div>
            <p className="glass-inset mt-2 rounded-xl p-3 font-mono text-[11.5px] text-muted">{redacted}</p>
          </div>
        </Section>

        <Vault />

        <Section
          title="Relay propio"
          description="Si despliegas en Vercel, el relay /api/relay exige el token que configures en la variable de entorno HARNESS_ACCESS_TOKEN. Escríbelo aquí (se guarda en la bóveda). En local (npm run dev) no hace falta."
        >
          <Field label="Token del relay">
            <input className="input font-mono text-xs" type="password" value={relayToken} onChange={(e) => useSecrets.getState().setKey('relay', e.target.value.trim())} placeholder="El mismo valor que HARNESS_ACCESS_TOKEN" />
          </Field>
        </Section>

        <Section title={`Inspector de red (${netCount})`} description="Historial de esta sesión del navegador: no se guarda en disco.">
          <div className="glass-inset h-[28rem] overflow-hidden rounded-2xl">
            <NetworkPanel />
          </div>
        </Section>

        <Section title="Botón de pánico" description="Borra de este navegador todas las conversaciones, workspaces, extensiones, ajustes y la bóveda.">
          <button className="btn btn-danger" onClick={panic}>
            <Trash2 size={14} /> Borrar todos mis datos locales
          </button>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
            <Network size={12} /> No afecta a lo que ya enviaste a un proveedor: eso queda bajo su política de datos.
          </p>
        </Section>
      </div>
    </PageShell>
  )
}
