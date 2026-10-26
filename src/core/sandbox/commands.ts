// Comandos extra del bash virtual: python/python3/pip y node, que delegan en
// los workers aislados. Se registran una vez al importar este módulo.

import { defineCommand, normalizePath, registerCommandFactory, type Workspace } from './workspace'
import { python } from './python'
import { runJavaScript } from './javascript'

function stdinText(stdin: unknown): string {
  if (typeof stdin !== 'string' || stdin === '') return ''
  // just-bash entrega stdin como "ByteString" (un char por byte, latin1).
  const bytes = new Uint8Array(stdin.length)
  for (let i = 0; i < stdin.length; i++) bytes[i] = stdin.charCodeAt(i) & 0xff
  return new TextDecoder().decode(bytes)
}

function pythonCommand(name: string, ws: Workspace) {
  return defineCommand(name, async (args, ctx) => {
    if (args[0] === '-V' || args[0] === '--version') {
      return { stdout: 'Python 3.14 (Pyodide, sandbox de ISC AGENT)\n', stderr: '', exitCode: 0 }
    }
    let code: string
    let argv: string[]
    if (args[0] === '-c') {
      code = args[1] ?? ''
      argv = ['-c', ...args.slice(2)]
    } else if (args[0] === '-m' && args[1]) {
      code = `import runpy\nrunpy.run_module(${JSON.stringify(args[1])}, run_name='__main__', alter_sys=True)`
      argv = [args[1], ...args.slice(2)]
    } else if (args[0] && args[0] !== '-') {
      const path = normalizePath(args[0], ctx.cwd)
      if (!(await ws.fs.exists(path))) {
        return { stdout: '', stderr: `${name}: no se puede abrir '${args[0]}': no existe el archivo\n`, exitCode: 2 }
      }
      code = await ws.readText(path)
      argv = [path, ...args.slice(1)]
    } else {
      code = stdinText(ctx.stdin)
      argv = ['-']
    }
    const r = await python.run(ws, code, { argv, cwd: ctx.cwd, timeoutMs: 120_000 })
    let stderr = r.stderr
    if (!r.ok && r.error && !stderr.includes(r.error)) stderr += `${r.error}\n`
    return { stdout: r.stdout, stderr, exitCode: r.ok ? 0 : 1 }
  })
}

function nodeCommand(name: string, ws: Workspace) {
  return defineCommand(name, async (args, ctx) => {
    if (args[0] === '-v' || args[0] === '--version') {
      return { stdout: 'v0-sandbox (worker de JavaScript de ISC AGENT, sin red)\n', stderr: '', exitCode: 0 }
    }
    let code: string
    let argv: string[]
    if (args[0] === '-e' || args[0] === '-p') {
      code = args[0] === '-p' ? `return (${args[1] ?? 'undefined'})` : (args[1] ?? '')
      argv = args.slice(2)
    } else if (args[0]) {
      const path = normalizePath(args[0], ctx.cwd)
      if (!(await ws.fs.exists(path))) {
        return { stdout: '', stderr: `${name}: no existe el archivo '${args[0]}'\n`, exitCode: 1 }
      }
      code = await ws.readText(path)
      argv = [path, ...args.slice(1)]
    } else {
      code = stdinText(ctx.stdin)
      argv = []
    }
    const r = await runJavaScript(ws, code, { argv })
    let stdout = r.stdout
    if (args[0] === '-p' && r.result !== undefined) stdout += `${r.result}\n`
    return { stdout, stderr: r.stderr + (r.error ? `${r.error}\n` : ''), exitCode: r.ok ? 0 : 1 }
  })
}

const pip = defineCommand('pip', async () => ({
  stdout: '',
  stderr:
    'pip no está disponible en el sandbox. Los paquetes de Pyodide (numpy, pandas, matplotlib…) se cargan solos al importarlos si activas "Permitir paquetes de Python" en Ajustes → Sandbox.\n',
  exitCode: 1,
}))

registerCommandFactory((ws) => [
  pythonCommand('python3', ws),
  pythonCommand('python', ws),
  nodeCommand('node', ws),
  nodeCommand('js', ws),
  pip,
  defineCommand('pip3', pip.execute),
])
