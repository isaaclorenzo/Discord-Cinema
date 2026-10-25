import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import CodeMirror, { type Extension } from '@uiw/react-codemirror'
import { zipSync } from 'fflate'
import { ChevronRight, Download, Eye, File, FilePlus, Folder, FolderOpen, FolderPlus, Pencil, Save, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadBlob } from '../../app/export'
import { buildPreviewHtml } from '../../core/sandbox/preview'
import type { FileInfo, Workspace } from '../../core/sandbox/workspace'
import { formatBytes, imageMediaType, looksTextual, bytesToBase64 } from '../../core/util'
import { useSettings } from '../../state/settings'
import { useUi } from '../../state/ui'
import { useWorkspace } from '../hooks'
import { Empty, Spinner } from '../primitives'
import { cx } from '../cx'

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '12.5px' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid rgba(255,255,255,0.06)' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
})

function TreeNode({ ws, entry, depth, version, selected, onSelect }: { ws: Workspace; entry: FileInfo; depth: number; version: number; selected: string | null; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState(depth < 1)
  const [children, setChildren] = useState<FileInfo[]>([])
  useEffect(() => {
    if (entry.isDir && open) void ws.list(entry.path).then(setChildren)
  }, [ws, entry, open, version])
  const pad = { paddingLeft: `${depth * 12 + 8}px` }
  if (!entry.isDir) {
    return (
      <button
        style={pad}
        onClick={() => onSelect(entry.path)}
        className={cx('flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[12.5px] hover:bg-white/6', selected === entry.path ? 'bg-violet-500/15 text-fg' : 'text-fg/80')}
      >
        <File size={13} className="shrink-0 text-faint" />
        <span className="truncate">{entry.name}</span>
        <span className="ml-auto shrink-0 text-[10px] text-faint">{formatBytes(entry.size)}</span>
      </button>
    )
  }
  return (
    <div>
      <button style={pad} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[12.5px] text-fg/85 hover:bg-white/6">
        <ChevronRight size={12} className={cx('shrink-0 text-faint transition', open && 'rotate-90')} />
        {open ? <FolderOpen size={13} className="shrink-0 text-violet-200" /> : <Folder size={13} className="shrink-0 text-violet-200" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && children.map((c) => <TreeNode key={c.path} ws={ws} entry={c} depth={depth + 1} version={version} selected={selected} onSelect={onSelect} />)}
    </div>
  )
}

function Editor({ ws, path, version, onClose }: { ws: Workspace; path: string; version: number; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [binary, setBinary] = useState<{ size: number; image?: string } | null>(null)
  const [langState, setLangState] = useState<{ path: string; ext: Extension[] } | null>(null)
  const lang = langState?.path === path ? langState.ext : []
  const dirty = content !== null && content !== saved

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!(await ws.exists(path))) {
        onClose()
        return
      }
      const bytes = await ws.readBytes(path)
      if (!alive) return
      const media = imageMediaType(path) ?? (path.endsWith('.svg') ? 'image/svg+xml' : null)
      if (media && !path.endsWith('.svg')) {
        setBinary({ size: bytes.length, image: `data:${media};base64,${bytesToBase64(bytes)}` })
        return
      }
      if (!looksTextual(path, bytes)) {
        setBinary({ size: bytes.length })
        return
      }
      const text = new TextDecoder().decode(bytes)
      setBinary(null)
      setSaved(text)
      setContent((prev) => (prev !== null && prev !== saved ? prev : text))
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, path, version])

  useEffect(() => {
    const desc = LanguageDescription.matchFilename(languages, path)
    if (desc) void desc.load().then((support) => setLangState({ path, ext: [support] }))
  }, [path])

  const save = useCallback(async () => {
    if (content === null) return
    await ws.writeFile(path, content)
    setSaved(content)
    useUi.getState().toast('Guardado', 'success')
  }, [content, path, ws])

  const preview = async () => {
    const html = await buildPreviewHtml(ws, path)
    useUi.getState().setPreview({ sessionId: ws.id, title: path, html, path })
    useSettings.getState().setUi({ rightTab: 'preview' })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-white/[0.07] px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" title={path}>
          {path.replace('/workspace/', '')}
          {dirty && <span className="ml-1 text-amber">●</span>}
        </span>
        {/\.html?$/.test(path) && (
          <button className="btn btn-ghost btn-icon" onClick={preview} title="Vista previa">
            <Eye size={14} />
          </button>
        )}
        {content !== null && (
          <button className="btn btn-ghost btn-icon" onClick={save} disabled={!dirty} title="Guardar (Ctrl+S)">
            <Save size={14} />
          </button>
        )}
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar editor">
          <X size={14} />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            void save()
          }
        }}
      >
        {binary ? (
          binary.image ? (
            <div className="grid place-items-center p-4">
              <img src={binary.image} alt={path} className="max-h-[60vh] rounded-xl" />
            </div>
          ) : (
            <Empty title="Archivo binario">{formatBytes(binary.size)} · no se puede editar como texto.</Empty>
          )
        ) : content === null ? (
          <div className="grid place-items-center p-6">
            <Spinner />
          </div>
        ) : (
          <CodeMirror value={content} onChange={setContent} theme={oneDark} extensions={[editorTheme, EditorView.lineWrapping, ...lang]} basicSetup={{ foldGutter: false }} />
        )}
      </div>
    </div>
  )
}

export function FilesPanel({ sessionId }: { sessionId: string }) {
  const { ws, version } = useWorkspace(sessionId)
  const [root, setRoot] = useState<FileInfo[]>([])
  const openFile = useUi((s) => s.openFile)
  const setOpenFile = useUi((s) => s.setOpenFile)
  const upload = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ws) void ws.list('/workspace').then(setRoot)
  }, [ws, version])

  if (!ws) return <div className="grid place-items-center p-6"><Spinner /></div>

  const create = async (dir: boolean) => {
    const name = prompt(dir ? 'Nombre de la carpeta (ruta dentro de /workspace)' : 'Nombre del archivo (ruta dentro de /workspace)')
    if (!name) return
    const path = `/workspace/${name.replace(/^\/+|^workspace\//g, '')}`
    if (dir) await ws.mkdir(path)
    else {
      if (!(await ws.exists(path))) await ws.writeFile(path, '')
      setOpenFile(path)
    }
  }

  const exportZip = async () => {
    const files = await ws.walk('/workspace')
    const entries: Record<string, Uint8Array> = {}
    for (const f of files) entries[f.path.replace('/workspace/', '')] = await ws.readBytes(f.path)
    const zip = zipSync(entries, { level: 6 })
    downloadBlob('workspace.zip', new Blob([zip as BlobPart], { type: 'application/zip' }))
  }

  const onUpload = async (list: FileList | null) => {
    if (!list) return
    for (const f of Array.from(list)) await ws.writeFile(`/workspace/${f.name}`, new Uint8Array(await f.arrayBuffer()))
    useUi.getState().toast(`${list.length} archivo(s) subidos al workspace`, 'success')
  }

  const removeSelected = async () => {
    if (!openFile) return
    if (!confirm(`¿Borrar ${openFile}?`)) return
    await ws.remove(openFile)
    setOpenFile(null)
  }

  const renameSelected = async () => {
    if (!openFile) return
    const to = prompt('Nueva ruta', openFile)
    if (!to || to === openFile) return
    await ws.rename(openFile, to)
    setOpenFile(ws.resolve(to))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 border-b border-white/[0.07] px-2 py-1.5">
        <span className="flex-1 truncate px-1 font-mono text-[11px] text-faint">/workspace</span>
        <button className="btn btn-ghost btn-icon" onClick={() => create(false)} title="Nuevo archivo">
          <FilePlus size={14} />
        </button>
        <button className="btn btn-ghost btn-icon" onClick={() => create(true)} title="Nueva carpeta">
          <FolderPlus size={14} />
        </button>
        <input ref={upload} type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
        <button className="btn btn-ghost btn-icon" onClick={() => upload.current?.click()} title="Subir archivos">
          <Upload size={14} />
        </button>
        <button className="btn btn-ghost btn-icon" onClick={exportZip} title="Descargar el workspace (.zip)">
          <Download size={14} />
        </button>
        {openFile && (
          <>
            <button className="btn btn-ghost btn-icon" onClick={renameSelected} title="Renombrar o mover">
              <Pencil size={14} />
            </button>
            <button className="btn btn-ghost btn-icon hover:text-rose-200" onClick={removeSelected} title="Borrar">
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
      <div className={cx('min-h-0 overflow-y-auto p-1.5', openFile ? 'max-h-[38%] shrink-0 border-b border-white/[0.07]' : 'flex-1')}>
        {root.length === 0 ? (
          <Empty icon={<Folder size={22} />} title="Workspace vacío">
            Los archivos que cree el modelo aparecerán aquí. También puedes subir los tuyos (solo datos no sensibles).
          </Empty>
        ) : (
          root.map((e) => <TreeNode key={e.path} ws={ws} entry={e} depth={0} version={version} selected={openFile} onSelect={setOpenFile} />)
        )}
      </div>
      {openFile && <Editor key={openFile} ws={ws} path={openFile} version={version} onClose={() => setOpenFile(null)} />}
    </div>
  )
}
