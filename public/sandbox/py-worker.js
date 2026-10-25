// Worker de Python (Pyodide) de Glasshouse.
//
// Se sirve como archivo estático con su propia CSP (connect-src limitado a
// /pyodide/ y al CDN de paquetes). Además, aquí dentro se anula todo acceso a
// red salvo esas dos rutas, para que el código del modelo no pueda enviar
// datos a ningún sitio.

// La base respeta despliegues en subcarpetas (p. ej. GitHub Pages /Discord-Cinema/).
const BASE = new URL('../', self.location.href).href
const PYODIDE_BASE = `${BASE}pyodide/`
let packageCdn = null

// ---------------------------------------------------------------------------
// Bloqueo de red
// ---------------------------------------------------------------------------
const realFetch = self.fetch.bind(self)

function urlOf(input) {
  if (typeof input === 'string') return new URL(input, self.location.href).href
  if (input instanceof URL) return input.href
  return new URL(input.url, self.location.href).href
}

function guardedFetch(input, init) {
  const href = urlOf(input)
  const ok = href.startsWith(PYODIDE_BASE) || (packageCdn !== null && href.startsWith(packageCdn))
  if (!ok) return Promise.reject(new TypeError(`Red bloqueada en el sandbox de Python: ${href}`))
  return realFetch(input, init)
}

function blocked(name) {
  return function () {
    throw new TypeError(`${name} está bloqueado en el sandbox de Python`)
  }
}

;(function lockdown() {
  for (let o = self; o; o = Object.getPrototypeOf(o)) {
    if (Object.prototype.hasOwnProperty.call(o, 'fetch')) {
      try {
        Object.defineProperty(o, 'fetch', { value: guardedFetch, writable: false, configurable: false })
      } catch {
        /* ignorado */
      }
    }
    if (Object.prototype.hasOwnProperty.call(o, 'importScripts')) {
      try {
        Object.defineProperty(o, 'importScripts', { value: blocked('importScripts'), writable: false, configurable: false })
      } catch {
        /* ignorado */
      }
    }
  }
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'Worker', 'SharedWorker', 'FontFace', 'BroadcastChannel', 'RTCPeerConnection']) {
    try {
      Object.defineProperty(self, name, { value: blocked(name), writable: false, configurable: false })
    } catch {
      /* ignorado */
    }
  }
  try {
    Object.defineProperty(self, 'fonts', { value: undefined, writable: false, configurable: false })
  } catch {
    /* ignorado */
  }
})()

// ---------------------------------------------------------------------------
// Pyodide
// ---------------------------------------------------------------------------
let pyodidePromise = null
const namespaces = new Map()

async function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      self.postMessage({ type: 'status', text: 'Cargando Python (Pyodide)…' })
      const mod = await import(`${PYODIDE_BASE}pyodide.mjs`)
      packageCdn = `https://cdn.jsdelivr.net/pyodide/v${mod.version}/full/`
      const allowCdn = packageCdn
      packageCdn = null // solo se habilita durante la carga de paquetes permitida
      const py = await mod.loadPyodide({
        indexURL: PYODIDE_BASE,
        lockFileURL: `${PYODIDE_BASE}pyodide-lock.json`,
        packageBaseUrl: allowCdn,
        stdout: () => {},
        stderr: () => {},
      })
      py.__cdn = allowCdn
      py.runPython(`
import os, sys
os.makedirs('/workspace', exist_ok=True)
os.environ['HOME'] = '/workspace'
os.environ['MPLBACKEND'] = 'AGG'
`)
      self.postMessage({ type: 'status', text: '' })
      return py
    })()
  }
  return pyodidePromise
}

function namespaceFor(py, key) {
  let ns = namespaces.get(key)
  if (!ns) {
    ns = py.globals.get('dict')()
    ns.set('__name__', '__main__')
    namespaces.set(key, ns)
  }
  return ns
}

function mkdirTree(py, path) {
  py.FS.mkdirTree(path)
}

function rmTree(py, path) {
  let entries
  try {
    entries = py.FS.readdir(path)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === '.' || name === '..') continue
    const p = `${path}/${name}`
    const st = py.FS.stat(p)
    if (py.FS.isDir(st.mode)) {
      rmTree(py, p)
      py.FS.rmdir(p)
    } else py.FS.unlink(p)
  }
}

function walk(py, path, out) {
  for (const name of py.FS.readdir(path)) {
    if (name === '.' || name === '..' || name === '__pycache__') continue
    const p = `${path}/${name}`
    const st = py.FS.stat(p)
    if (py.FS.isDir(st.mode)) walk(py, p, out)
    else out.push(p)
  }
  return out
}

function sameBytes(a, b) {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

async function run(msg) {
  const { id, code, files, cwd, argv, stdin, allowPackages, sessionKey } = msg
  const post = (type, text) => self.postMessage({ type, id, text })
  let py
  try {
    py = await getPyodide()
  } catch (e) {
    self.postMessage({ type: 'done', id, ok: false, error: `No se pudo cargar Pyodide: ${e && e.message ? e.message : e}`, files: [], deleted: [] })
    return
  }

  // Sincroniza /workspace con el VFS de la harness.
  const before = new Map(files)
  rmTree(py, '/workspace')
  mkdirTree(py, '/workspace')
  for (const [path, data] of files) {
    mkdirTree(py, path.slice(0, path.lastIndexOf('/')) || '/')
    py.FS.writeFile(path, data)
  }

  py.setStdout({ batched: (s) => post('stdout', `${s}\n`) })
  py.setStderr({ batched: (s) => post('stderr', `${s}\n`) })
  const lines = (stdin || '').split('\n')
  let li = 0
  py.setStdin({ stdin: () => (li < lines.length ? lines[li++] : null) })

  let ok = true
  let error = null
  let result = null
  try {
    try {
      py.FS.chdir(cwd && cwd.startsWith('/workspace') ? cwd : '/workspace')
    } catch {
      py.FS.chdir('/workspace')
    }
    py.globals.set('__gh_argv', py.toPy(argv && argv.length ? argv : ['<stdin>']))
    py.runPython('import sys; sys.argv = list(__gh_argv)')
    if (allowPackages) {
      packageCdn = py.__cdn
      try {
        await py.loadPackagesFromImports(code, {
          messageCallback: (m) => self.postMessage({ type: 'status', text: m }),
          errorCallback: (m) => post('stderr', `${m}\n`),
        })
      } finally {
        packageCdn = null
      }
    }
    const ns = namespaceFor(py, sessionKey || 'default')
    const value = await py.runPythonAsync(code, { globals: ns, filename: (argv && argv[0]) || '<stdin>' })
    if (value !== undefined && value !== null) {
      try {
        result = String(value.toString ? value.toString() : value)
      } catch {
        result = String(value)
      }
      if (value && typeof value.destroy === 'function') value.destroy()
    }
  } catch (e) {
    ok = false
    const text = e && e.message ? e.message : String(e)
    error = text
    if (/ModuleNotFoundError/.test(text) && !allowPackages) {
      error += '\n[Glasshouse] Los paquetes externos (numpy, pandas…) están desactivados. Actívalos en Ajustes → Sandbox.'
    }
  } finally {
    py.setStdin({ stdin: () => null })
  }

  // Devuelve los archivos nuevos o modificados y los borrados.
  const changed = []
  const now = new Set()
  try {
    for (const p of walk(py, '/workspace', [])) {
      now.add(p)
      const data = py.FS.readFile(p)
      if (!sameBytes(before.get(p), data)) changed.push([p, data])
    }
  } catch (e) {
    post('stderr', `[Glasshouse] Error leyendo archivos: ${e}\n`)
  }
  const deleted = [...before.keys()].filter((p) => !now.has(p))
  self.postMessage({ type: 'done', id, ok, error, result, files: changed, deleted })
}

self.onmessage = (ev) => {
  const msg = ev.data
  if (msg && msg.type === 'run') run(msg)
  else if (msg && msg.type === 'warmup') getPyodide().catch(() => {})
}
