// Worker de JavaScript de Glasshouse.
//
// Ejecuta código del modelo o de plugins sin acceso a red: se sirve con
// CSP connect-src 'none' y además aquí se anulan fetch, XHR, WebSocket, etc.
// El acceso a archivos y (si el usuario lo permite) a red pasa por un puente
// RPC con el hilo principal, que aplica permisos, guard e inspector.

const realPostMessage = self.postMessage.bind(self)

function blocked(name) {
  return function () {
    throw new TypeError(`${name} está bloqueado en el sandbox de JavaScript`)
  }
}

;(function lockdown() {
  const names = ['fetch', 'importScripts']
  for (let o = self; o; o = Object.getPrototypeOf(o)) {
    for (const n of names) {
      if (Object.prototype.hasOwnProperty.call(o, n)) {
        try {
          Object.defineProperty(o, n, { value: blocked(n), writable: false, configurable: false })
        } catch {
          /* ignorado */
        }
      }
    }
  }
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'Worker', 'SharedWorker', 'FontFace', 'BroadcastChannel', 'RTCPeerConnection', 'indexedDB', 'caches']) {
    try {
      Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false })
    } catch {
      /* ignorado */
    }
  }
})()

let callSeq = 0
const pending = new Map()

function rpc(id, method, params) {
  const callId = ++callSeq
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject })
    realPostMessage({ type: 'rpc', id, callId, method, params })
  })
}

function format(v) {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function run(msg) {
  const { id, code, args, argv } = msg
  const out = (stream) => (...parts) => realPostMessage({ type: stream, id, text: `${parts.map(format).join(' ')}\n` })
  const consoleShim = { log: out('stdout'), info: out('stdout'), debug: out('stdout'), warn: out('stderr'), error: out('stderr'), table: out('stdout') }
  const fs = {
    readFile: (path) => rpc(id, 'fs.readFile', { path }),
    writeFile: (path, content) => rpc(id, 'fs.writeFile', { path, content: String(content) }),
    list: (path = '.') => rpc(id, 'fs.list', { path }),
    exists: (path) => rpc(id, 'fs.exists', { path }),
    remove: (path) => rpc(id, 'fs.remove', { path }),
  }
  const host = {
    fetch: (url, init) => rpc(id, 'net.fetch', { url: String(url), init: init || {} }),
    exec: (command) => rpc(id, 'bash.exec', { command: String(command) }),
  }
  const processShim = {
    argv: ['node', ...(argv || [])],
    env: { HOME: '/workspace' },
    cwd: () => '/workspace',
    exit: (c) => {
      throw Object.assign(new Error(`process.exit(${c ?? 0})`), { __exit: c ?? 0 })
    },
  }
  try {
    const fn = new AsyncFunction('fs', 'host', 'args', 'console', 'process', code)
    const value = await fn(fs, host, args, consoleShim, processShim)
    realPostMessage({ type: 'done', id, ok: true, result: value === undefined ? undefined : format(value) })
  } catch (e) {
    if (e && e.__exit !== undefined) {
      realPostMessage({ type: 'done', id, ok: e.__exit === 0, exitCode: e.__exit })
      return
    }
    realPostMessage({ type: 'done', id, ok: false, error: e && e.stack ? String(e.stack) : String(e) })
  }
}

self.onmessage = (ev) => {
  const msg = ev.data
  if (!msg) return
  if (msg.type === 'run') run(msg)
  else if (msg.type === 'rpc_result') {
    const p = pending.get(msg.callId)
    if (!p) return
    pending.delete(msg.callId)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  }
}
