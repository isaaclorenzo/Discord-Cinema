import { describe, expect, it } from 'vitest'
import { EditTool, GlobTool, GrepTool, LSTool, MultiEditTool, NotebookEditTool, ReadTool, WriteTool } from '../src/core/tools/files'
import { BashOutputTool, BashTool } from '../src/core/tools/exec'
import { TodoWriteTool, ExitPlanModeTool } from '../src/core/tools/agent'
import { validateInput, coerceInput } from '../src/core/tools/validate'
import { buildToolset } from '../src/core/tools/registry'
import { ctx, fakeAgent, makeWorkspace } from './helpers'

describe('Read / Write / Edit', () => {
  it('lee con números de línea y paginación', async () => {
    const ws = await makeWorkspace({ 'a.txt': 'uno\ndos\ntres\n' })
    const r = await ReadTool.run({ file_path: 'a.txt' }, ctx(ws))
    expect(r.content).toBe('     1\tuno\n     2\tdos\n     3\ttres')
    const r2 = await ReadTool.run({ file_path: '/workspace/a.txt', offset: 2, limit: 1 }, ctx(ws))
    expect(r2.content).toContain('     2\tdos')
    expect(r2.content).toContain('Showing lines 2-2 of 3')
  })

  it('exige leer antes de editar o sobrescribir', async () => {
    const ws = await makeWorkspace({ 'a.txt': 'hola mundo' })
    const e = await EditTool.run({ file_path: 'a.txt', old_string: 'hola', new_string: 'adiós' }, ctx(ws))
    expect(e.isError).toBe(true)
    expect(e.content).toMatch(/Read it first/)
    const w = await WriteTool.run({ file_path: 'a.txt', content: 'x' }, ctx(ws))
    expect(w.isError).toBe(true)
  })

  it('edita con old_string único y rechaza ambigüedad', async () => {
    const ws = await makeWorkspace({ 'a.txt': 'foo bar foo' })
    await ReadTool.run({ file_path: 'a.txt' }, ctx(ws))
    const amb = await EditTool.run({ file_path: 'a.txt', old_string: 'foo', new_string: 'baz' }, ctx(ws))
    expect(amb.isError).toBe(true)
    expect(amb.content).toMatch(/appears 2 times/)
    const ok = await EditTool.run({ file_path: 'a.txt', old_string: 'foo', new_string: 'baz', replace_all: true }, ctx(ws))
    expect(ok.isError).toBeFalsy()
    expect(await ws.readText('a.txt')).toBe('baz bar baz')
    expect(ok.display?.kind).toBe('diff')
  })

  it('no interpreta patrones $ en new_string', async () => {
    const ws = await makeWorkspace({ 'a.txt': 'precio: X' })
    await ReadTool.run({ file_path: 'a.txt' }, ctx(ws))
    await EditTool.run({ file_path: 'a.txt', old_string: 'X', new_string: "$& y $'" }, ctx(ws))
    expect(await ws.readText('a.txt')).toBe("precio: $& y $'")
  })

  it('MultiEdit es atómico', async () => {
    const ws = await makeWorkspace({ 'a.txt': 'a b c' })
    await ReadTool.run({ file_path: 'a.txt' }, ctx(ws))
    const bad = await MultiEditTool.run(
      { file_path: 'a.txt', edits: [{ old_string: 'a', new_string: 'A' }, { old_string: 'zzz', new_string: 'Z' }] },
      ctx(ws),
    )
    expect(bad.isError).toBe(true)
    expect(await ws.readText('a.txt')).toBe('a b c')
    await MultiEditTool.run({ file_path: 'a.txt', edits: [{ old_string: 'a', new_string: 'A' }, { old_string: 'A b', new_string: 'AB' }] }, ctx(ws))
    expect(await ws.readText('a.txt')).toBe('AB c')
  })

  it('Write crea directorios y permite editar después', async () => {
    const ws = await makeWorkspace()
    const w = await WriteTool.run({ file_path: 'src/deep/x.py', content: 'print(1)\n' }, ctx(ws))
    expect(w.content).toMatch(/created/)
    const e = await EditTool.run({ file_path: 'src/deep/x.py', old_string: '1', new_string: '2' }, ctx(ws))
    expect(e.isError).toBeFalsy()
  })

  it('detecta archivos modificados desde la lectura', async () => {
    const ws = await makeWorkspace({ 'a.txt': 'v1' })
    await ReadTool.run({ file_path: 'a.txt' }, ctx(ws))
    await new Promise((r) => setTimeout(r, 5))
    ws.readState.set('/workspace/a.txt', 0)
    await ws.fs.writeFile('/workspace/a.txt', 'v2')
    const e = await EditTool.run({ file_path: 'a.txt', old_string: 'v2', new_string: 'v3' }, ctx(ws))
    expect(e.content).toMatch(/modified since it was read/)
  })
})

describe('Glob / Grep / LS', () => {
  it('glob con ** y patrón simple', async () => {
    const ws = await makeWorkspace({ 'src/a.ts': '', 'src/lib/b.ts': '', 'c.md': '' })
    const r = await GlobTool.run({ pattern: '**/*.ts' }, ctx(ws))
    expect(r.content.split('\n').sort()).toEqual(['/workspace/src/a.ts', '/workspace/src/lib/b.ts'])
    const r2 = await GlobTool.run({ pattern: '*.md' }, ctx(ws))
    expect(r2.content).toBe('/workspace/c.md')
  })

  it('grep en sus tres modos', async () => {
    const ws = await makeWorkspace({ 'a.py': 'def foo():\n    return 1\n# TODO x\n', 'b.js': 'const TODO = 1\n' })
    const files = await GrepTool.run({ pattern: 'TODO' }, ctx(ws))
    expect(files.content).toMatch(/Found 2 files/)
    const content = await GrepTool.run({ pattern: 'todo', '-i': true, output_mode: 'content', type: 'py' }, ctx(ws))
    expect(content.content).toBe('/workspace/a.py:3:# TODO x')
    const ctxLines = await GrepTool.run({ pattern: 'return', output_mode: 'content', '-B': 1 }, ctx(ws))
    expect(ctxLines.content).toContain('/workspace/a.py-1-def foo():')
    const count = await GrepTool.run({ pattern: 'TODO', output_mode: 'count', glob: '*.js' }, ctx(ws))
    expect(count.content).toBe('/workspace/b.js:1')
    const ml = await GrepTool.run({ pattern: 'foo.*return', multiline: true, output_mode: 'content' }, ctx(ws))
    expect(ml.content).toContain(':2:')
    const bad = await GrepTool.run({ pattern: '(' }, ctx(ws))
    expect(bad.isError).toBe(true)
  })

  it('LS muestra el árbol', async () => {
    const ws = await makeWorkspace({ 'a/b.txt': '', 'c.txt': '' })
    const r = await LSTool.run({}, ctx(ws))
    expect(r.content).toContain('- a/')
    expect(r.content).toContain('    - b.txt')
  })
})

describe('Bash', () => {
  it('ejecuta comandos y mantiene el cwd', async () => {
    const ws = await makeWorkspace({ 'data.csv': 'x,y\n1,2\n3,4\n' })
    const r = await BashTool.run({ command: 'mkdir -p out && cd out && pwd' }, ctx(ws))
    expect(r.content).toBe('/workspace/out')
    const r2 = await BashTool.run({ command: 'pwd' }, ctx(ws))
    expect(r2.content).toBe('/workspace/out')
    const r3 = await BashTool.run({ command: "tail -n +2 ../data.csv | awk -F, '{s+=$1} END {print s}'" }, ctx(ws))
    expect(r3.content).toBe('4')
  })

  it('no tiene red', async () => {
    const ws = await makeWorkspace()
    const r = await BashTool.run({ command: 'curl https://example.com' }, ctx(ws))
    expect(r.content).toMatch(/exit code 127|not found/)
  })

  it('shells en segundo plano', async () => {
    const ws = await makeWorkspace()
    const agent = fakeAgent()
    const r = await BashTool.run({ command: 'echo hola', run_in_background: true }, ctx(ws, agent))
    const id = r.content.match(/id: (\S+)\./)![1]
    await new Promise((res) => setTimeout(res, 50))
    const out = await BashOutputTool.run({ bash_id: id }, ctx(ws, agent))
    expect(out.content).toContain('<status>completed</status>')
    expect(out.content).toContain('hola')
  })
})

describe('Herramientas de agente', () => {
  it('TodoWrite guarda la lista', async () => {
    const ws = await makeWorkspace()
    const agent = fakeAgent()
    await TodoWriteTool.run({ todos: [{ content: 'Hacer X', status: 'in_progress', activeForm: 'Haciendo X' }] }, ctx(ws, agent))
    expect(agent.getTodos()).toHaveLength(1)
  })

  it('ExitPlanMode sale del modo plan al aprobar', async () => {
    const ws = await makeWorkspace()
    const agent = fakeAgent()
    agent.setMode('plan')
    const r = await ExitPlanModeTool.run({ plan: '1. hacer' }, ctx(ws, agent))
    expect(r.content).toMatch(/approved/)
    expect(agent.getMode()).toBe('acceptEdits')
  })

  it('NotebookEdit inserta y reemplaza celdas', async () => {
    const ws = await makeWorkspace()
    const nb = await NotebookEditTool.run({ notebook_path: 'n.ipynb', new_source: 'print(1)', cell_type: 'code', edit_mode: 'insert' }, ctx(ws))
    expect(nb.isError).toBeFalsy()
    await NotebookEditTool.run({ notebook_path: 'n.ipynb', cell_id: 'cell-0', new_source: 'print(2)' }, ctx(ws))
    const r = await ReadTool.run({ file_path: 'n.ipynb' }, ctx(ws))
    expect(r.content).toContain('print(2)')
  })
})

describe('Validación y registro', () => {
  it('valida y corrige entradas', () => {
    const schema = BashTool.inputSchema
    expect(validateInput(schema, {})).toEqual(['input.command is required'])
    expect(validateInput(schema, { command: 1 })).toEqual(['input.command must be string, got integer'])
    expect(coerceInput(schema, { command: 'ls', timeout: '500' })).toEqual({ command: 'ls', timeout: 500 })
  })

  it('construye el toolset con filtros', () => {
    const all = buildToolset({ agents: [{ name: 'Explore', description: 'x' }], skills: [], commands: [] })
    expect(all.map((t) => t.name)).toContain('Task')
    const only = buildToolset({ agents: [], skills: [], commands: [], only: ['Read', 'Grep'] })
    expect(only.map((t) => t.name)).toEqual(['Read', 'Grep'])
  })
})
