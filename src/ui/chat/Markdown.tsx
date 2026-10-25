// Markdown de la salida del modelo, tratada como no fiable:
// - nunca se renderiza HTML crudo;
// - las imágenes remotas se bloquean (evita exfiltrar datos vía URL de imagen);
// - los enlaces piden confirmación mostrando la URL completa.

import { Check, Copy, ExternalLink, ImageOff, ShieldAlert } from 'lucide-react'
import { memo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { netFetch } from '../../core/net'
import { Modal, Spinner } from '../primitives'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function BlockedImage({ src, alt }: { src?: string; alt?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!src) return null
  if (src.startsWith('data:image/')) return <img src={src} alt={alt ?? ''} className="max-h-96 rounded-xl" />
  if (blobUrl) return <img src={blobUrl} alt={alt ?? ''} className="max-h-96 rounded-xl" />
  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await netFetch(src, { method: 'GET' }, { purpose: 'webfetch', label: `Imagen · ${hostOf(src)}`, via: 'relay', follow: true, maxBytes: 8 * 1024 * 1024 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) throw new Error('No es una imagen')
      setBlobUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <span className="my-1 inline-flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/5 px-3 py-2 text-xs text-amber-100/90">
      <ImageOff size={14} className="shrink-0" />
      <span className="min-w-0 break-all">
        Imagen remota bloqueada: <b>{hostOf(src)}</b>
        {alt ? ` · “${alt}”` : ''}
      </span>
      <button className="btn btn-icon px-2 py-1 text-[11px]" onClick={load} disabled={loading} title={src}>
        {loading ? <Spinner size={11} /> : 'Cargar vía relay'}
      </button>
      {error && <span className="text-danger">{error}</span>}
    </span>
  )
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.innerText ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className="group relative">
      <pre ref={ref}>{children}</pre>
      <button
        className="btn btn-icon absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        onClick={copy}
        aria-label="Copiar código"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

function MarkdownImpl({ text }: { text: string }) {
  const [pending, setPending] = useState<string | null>(null)
  return (
    <>
      <div className="prose-glass">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
          components={{
            img: ({ src, alt }) => <BlockedImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault()
                  if (href) setPending(href)
                }}
                rel="noopener noreferrer nofollow"
              >
                {children}
              </a>
            ),
            pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={
          <span className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-amber" /> Abrir un enlace del modelo
          </span>
        }
        footer={
          <>
            <button className="btn" onClick={() => setPending(null)}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                window.open(pending!, '_blank', 'noopener,noreferrer')
                setPending(null)
              }}
            >
              <ExternalLink size={14} /> Abrir
            </button>
          </>
        }
      >
        <p className="text-sm text-muted">
          El enlace lo escribió el modelo. Revisa la URL completa: una URL puede llevar datos codificados en sus parámetros.
        </p>
        <p className="glass-inset mt-3 break-all rounded-xl p-3 font-mono text-xs">{pending}</p>
        <p className="mt-2 text-xs text-muted">
          Dominio: <b className="text-fg">{pending && hostOf(pending)}</b>
        </p>
      </Modal>
    </>
  )
}

export const Markdown = memo(MarkdownImpl)
