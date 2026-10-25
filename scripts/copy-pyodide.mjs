// Copia el runtime de Pyodide a public/pyodide para servirlo desde el propio
// origen (sin depender de un CDN para el núcleo de Python).
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pyodide')
const dest = join(root, 'public', 'pyodide')
const files = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
  'package.json',
]

if (!existsSync(src)) {
  console.warn('[copy-pyodide] pyodide no está instalado; se omite.')
  process.exit(0)
}

const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version
const stamp = join(dest, 'package.json')
if (existsSync(stamp) && JSON.parse(readFileSync(stamp, 'utf8')).version === version) {
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
for (const f of files) cpSync(join(src, f), join(dest, f))
console.log(`[copy-pyodide] Pyodide ${version} copiado a public/pyodide`)
