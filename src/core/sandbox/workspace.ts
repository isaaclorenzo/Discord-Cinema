// Workspace aislado: sistema de archivos en memoria + bash virtual (just-bash).
// Nada de esto toca el disco real; la persistencia es una instantánea en IndexedDB.

import { Bash, InMemoryFs, defineCommand, type CustomCommand } from 'just-bash/browser'

export const HOME = '/workspace'
const MAX_TOTAL_BYTES = 256 * 1024 * 1024

export interface SnapshotEntry {
  path: string
  /** undefined → directorio */
  data?: Uint8Array
  mtime: number
}

export interface ExecOutput {
  stdout: string
  stderr: string
  exitCode: number
  cwd: string
}

export interface FileInfo {
  path: string
  name: string
  isDir: boolean
  size: number
  mtime: number
}

/** Comandos extra que se registran en el bash (python3, node…). Los aporta el host. */
export type CommandFactory = (ws: Workspace) => CustomCommand[]

let commandFactories: CommandFactory[] = []

export function registerCommandFactory(f: CommandFactory): void {
  commandFactories = [...commandFactories, f]
}

export function normalizePath(path: string, cwd = HOME): string {
  const raw = path.startsWith('/') ? path : `${cwd}/${path}`
  const out: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class Workspace {
  readonly id: string
  readonly fs: InMemoryFs
  readonly bash: Bash
  cwd = HOME
  version = 0
  /** Rutas leídas con Read y su mtime en ese momento (precondición de Edit/Write). */
  readonly readState = new Map<string, number>()
  private listeners = new Set<() => void>()

  private constructor(id: string, fs: InMemoryFs) {
    this.id = id
    this.fs = fs
    const custom = commandFactories.flatMap((f) => f(this))
    this.bash = new Bash({
      fs,
      cwd: HOME,
      env: {
        HOME,
        USER: 'sandbox',
        LANG: 'C.UTF-8',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        GLASSHOUSE: '1',
      },
      customCommands: custom,
      executionLimits: { maxCommandCount: 200_000 },
    })
  }

  static async create(id: string, snapshot?: SnapshotEntry[]): Promise<Workspace> {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: MAX_TOTAL_BYTES })
    await fs.mkdir(HOME, { recursive: true })
    await fs.mkdir('/tmp', { recursive: true })
    if (snapshot) {
      for (const e of snapshot) {
        if (!e.path.startsWith(HOME)) continue
        if (e.data === undefined) await fs.mkdir(e.path, { recursive: true })
        else {
          await fs.mkdir(dirname(e.path), { recursive: true })
          fs.writeFileSync(e.path, e.data, undefined, { mtime: new Date(e.mtime) })
        }
      }
    }
    return new Workspace(id, fs)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Marca el workspace como modificado (refresca la UI y programa el guardado). */
  touch(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }

  resolve(path: string): string {
    return normalizePath(path, this.cwd)
  }

  async exists(path: string): Promise<boolean> {
    return this.fs.exists(this.resolve(path))
  }

  async isDir(path: string): Promise<boolean> {
    const p = this.resolve(path)
    if (!(await this.fs.exists(p))) return false
    return (await this.fs.stat(p)).isDirectory
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return this.fs.readFileBuffer(this.resolve(path))
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readBytes(path))
  }

  async writeFile(path: string, content: string | Uint8Array, opts: { silent?: boolean } = {}): Promise<void> {
    const p = this.resolve(path)
    await this.fs.mkdir(dirname(p), { recursive: true })
    await this.fs.writeFile(p, typeof content === 'string' ? encoder.encode(content) : content)
    const st = await this.fs.stat(p)
    this.readState.set(p, st.mtime.getTime())
    if (!opts.silent) this.touch()
  }

  async mkdir(path: string): Promise<void> {
    await this.fs.mkdir(this.resolve(path), { recursive: true })
    this.touch()
  }

  async remove(path: string): Promise<void> {
    await this.fs.rm(this.resolve(path), { recursive: true, force: true })
    this.touch()
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = this.resolve(to)
    await this.fs.mkdir(dirname(dest), { recursive: true })
    await this.fs.mv(this.resolve(from), dest)
    this.touch()
  }

  async stat(path: string): Promise<FileInfo> {
    const p = this.resolve(path)
    const st = await this.fs.stat(p)
    return { path: p, name: basename(p), isDir: st.isDirectory, size: st.size, mtime: st.mtime.getTime() }
  }

  async list(dir: string): Promise<FileInfo[]> {
    const d = this.resolve(dir)
    const names = await this.fs.readdir(d)
    const out: FileInfo[] = []
    for (const name of names) {
      const p = d === '/' ? `/${name}` : `${d}/${name}`
      try {
        const st = await this.fs.stat(p)
        out.push({ path: p, name, isDir: st.isDirectory, size: st.size, mtime: st.mtime.getTime() })
      } catch {
        // enlace roto u otra entrada especial: se ignora
      }
    }
    return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  }

  /** Lista recursiva de archivos (no directorios) bajo `root`. */
  async walk(root = HOME, opts: { maxFiles?: number; includeDirs?: boolean } = {}): Promise<FileInfo[]> {
    const max = opts.maxFiles ?? 20_000
    const out: FileInfo[] = []
    const stack = [this.resolve(root)]
    while (stack.length && out.length < max) {
      const dir = stack.pop()!
      let entries: FileInfo[]
      try {
        entries = await this.list(dir)
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.isDir) {
          stack.push(e.path)
          if (opts.includeDirs) out.push(e)
        } else out.push(e)
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  async snapshot(): Promise<SnapshotEntry[]> {
    const entries = await this.walk(HOME, { includeDirs: true, maxFiles: 50_000 })
    const out: SnapshotEntry[] = []
    for (const e of entries) {
      if (e.isDir) out.push({ path: e.path, mtime: e.mtime })
      else out.push({ path: e.path, data: await this.fs.readFileBuffer(e.path), mtime: e.mtime })
    }
    return out
  }

  async clone(id: string): Promise<Workspace> {
    return Workspace.create(id, await this.snapshot())
  }

  async exec(command: string, opts: { signal?: AbortSignal; stdin?: string; cwd?: string } = {}): Promise<ExecOutput> {
    const cwd = opts.cwd ? this.resolve(opts.cwd) : this.cwd
    const res = await this.bash.exec(command, { cwd, signal: opts.signal, stdin: opts.stdin })
    const nextCwd = res.env?.PWD
    if (!opts.cwd && nextCwd && (await this.fs.exists(nextCwd))) this.cwd = nextCwd
    this.touch()
    return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, cwd: this.cwd }
  }

  /** Copia archivos auxiliares (skills, plugins) fuera de /workspace sin persistirlos. */
  async mountFiles(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
    for (const [rel, content] of Object.entries(files)) {
      const p = normalizePath(rel, root)
      await this.fs.mkdir(dirname(p), { recursive: true })
      await this.fs.writeFile(p, typeof content === 'string' ? encoder.encode(content) : content)
    }
  }
}

export { defineCommand }
