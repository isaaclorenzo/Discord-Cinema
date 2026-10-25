// Herramientas de ejecución: Bash (+ shells en segundo plano), Python y JavaScript.
// Todo corre en el sandbox del navegador, sin red.

import '../sandbox/commands'
import { python } from '../sandbox/python'
import { runJavaScript } from '../sandbox/javascript'
import { truncate, uid } from '../util'
import { errorResult, type BackgroundShell, type ToolDef } from './types'

const MAX_OUTPUT = 30_000

function formatExec(stdout: string, stderr: string, exitCode: number): string {
  const parts: string[] = []
  if (stdout) parts.push(truncate(stdout.replace(/\n$/, ''), MAX_OUTPUT))
  if (stderr) parts.push(truncate(stderr.replace(/\n$/, ''), MAX_OUTPUT / 2))
  if (exitCode !== 0) parts.push(`[exit code ${exitCode}]`)
  return parts.join('\n') || '(no output)'
}

export const BashTool: ToolDef<{ command: string; timeout?: number; description?: string; run_in_background?: boolean }> = {
  name: 'Bash',
  description: `Executes a bash command in a virtual, sandboxed shell (just-bash) over the in-browser workspace filesystem.

Environment:
- Working directory persists between calls (starts at /workspace). Environment variables and shell functions do NOT persist between calls.
- About 80 standard commands: ls, cat, cp, mv, rm, mkdir, find, grep/rg, sed, awk, sort, uniq, wc, head, tail, cut, tr, xargs, diff, tar, jq, yq, base64, sha256sum, seq, date, tree, etc. Pipes, redirections, &&, ||, loops, functions and heredocs work.
- python3 / python run Python 3 (Pyodide), node runs JavaScript; both see the workspace files.
- There is NO network access (no curl, git clone, npm/pip install) and no package managers. Use WebFetch/WebSearch for the web.
- Quote paths with spaces. Prefer the dedicated tools (Read, Edit, Write, Glob, Grep) for file operations.
- timeout in milliseconds (default 120000, max 600000). Output over ${MAX_OUTPUT} characters is truncated.
- run_in_background: true returns a shell id immediately; read its output with BashOutput and stop it with KillShell.`,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (max 600000)' },
      description: { type: 'string', description: 'Short description of what the command does (5-10 words)' },
      run_in_background: { type: 'boolean', description: 'Run in the background' },
    },
    required: ['command'],
  },
  readOnly: false,
  permission: 'exec',
  summarize: (i) => i.command,
  matchKey: (i) => i.command,
  async run(input, { ws, signal, agent }) {
    const timeout = Math.min(Math.max(input.timeout ?? 120_000, 1000), 600_000)
    if (input.run_in_background) {
      const controller = new AbortController()
      const shell: BackgroundShell = {
        id: uid('bash'),
        command: input.command,
        startedAt: Date.now(),
        status: 'running',
        stdout: '',
        stderr: '',
        readOffset: 0,
        controller,
      }
      agent.shells.set(shell.id, shell)
      const timer = setTimeout(() => controller.abort(), timeout)
      ws.exec(input.command, { signal: controller.signal })
        .then((r) => {
          shell.stdout = r.stdout
          shell.stderr = r.stderr
          shell.exitCode = r.exitCode
          if (shell.status === 'running') shell.status = r.exitCode === 0 ? 'completed' : 'failed'
        })
        .catch((e) => {
          shell.stderr += String((e as Error).message)
          if (shell.status === 'running') shell.status = 'failed'
        })
        .finally(() => clearTimeout(timer))
      return { content: `Command started in background with id: ${shell.id}. Use BashOutput to read its output.` }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const onAbort = () => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    const cwdBefore = ws.cwd
    try {
      const r = await ws.exec(input.command, { signal: controller.signal })
      return {
        content: formatExec(r.stdout, r.stderr, r.exitCode),
        isError: r.exitCode !== 0 && !r.stdout && !!r.stderr,
        display: { kind: 'terminal', command: input.command, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, cwd: cwdBefore },
      }
    } catch (e) {
      if (controller.signal.aborted && !signal.aborted) return errorResult(`Command timed out after ${timeout} ms`)
      return errorResult(`Command failed: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  },
}

export const BashOutputTool: ToolDef<{ bash_id: string; filter?: string }> = {
  name: 'BashOutput',
  description: 'Retrieves output from a background bash shell started with run_in_background. Returns only new output since the last check, plus the shell status. Optional filter: a regex; only matching lines are returned.',
  inputSchema: {
    type: 'object',
    properties: {
      bash_id: { type: 'string', description: 'Id of the background shell' },
      filter: { type: 'string', description: 'Optional regex to filter output lines' },
    },
    required: ['bash_id'],
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => i.bash_id,
  async run(input, { agent }) {
    const shell = agent.shells.get(input.bash_id)
    if (!shell) return errorResult(`No background shell with id ${input.bash_id}`)
    const all = shell.stdout + (shell.stderr ? `\n[stderr]\n${shell.stderr}` : '')
    let fresh = all.slice(shell.readOffset)
    shell.readOffset = all.length
    if (input.filter) {
      try {
        const re = new RegExp(input.filter)
        fresh = fresh
          .split('\n')
          .filter((l) => re.test(l))
          .join('\n')
      } catch (e) {
        return errorResult(`Invalid filter regex: ${(e as Error).message}`)
      }
    }
    return {
      content: `<status>${shell.status}</status>${shell.exitCode !== undefined ? `\n<exit_code>${shell.exitCode}</exit_code>` : ''}\n<output>\n${truncate(fresh, MAX_OUTPUT) || '(no new output)'}\n</output>`,
    }
  },
}

export const KillShellTool: ToolDef<{ shell_id: string }> = {
  name: 'KillShell',
  description: 'Kills a running background bash shell by its id.',
  inputSchema: {
    type: 'object',
    properties: { shell_id: { type: 'string', description: 'Id of the background shell to kill' } },
    required: ['shell_id'],
  },
  readOnly: false,
  permission: 'exec',
  summarize: (i) => i.shell_id,
  async run(input, { agent }) {
    const shell = agent.shells.get(input.shell_id)
    if (!shell) return errorResult(`No background shell with id ${input.shell_id}`)
    if (shell.status !== 'running') return { content: `Shell ${input.shell_id} already finished (${shell.status}).` }
    shell.status = 'killed'
    shell.controller.abort()
    return { content: `Successfully killed shell ${input.shell_id}.` }
  },
}

export const PythonTool: ToolDef<{ code: string; timeout?: number }> = {
  name: 'Python',
  description: `Runs Python 3 code (Pyodide/WebAssembly) in an isolated worker with no network access.
- The workspace files are available under /workspace (the working directory). Files you create or modify are synced back.
- Variables persist between calls in the same session (like a notebook kernel). print() output is returned; the value of the last expression is returned too.
- The standard library is available. Scientific packages (numpy, pandas, matplotlib, scipy…) load automatically on import only if the user enabled them; otherwise imports fail.
- No input(), no network, no subprocess. Save plots with plt.savefig('/workspace/plot.png') and then Read the image to see it.
- timeout in milliseconds (default 120000).`,
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python code to run' },
      timeout: { type: 'number', description: 'Timeout in milliseconds' },
    },
    required: ['code'],
  },
  readOnly: false,
  permission: 'exec',
  summarize: (i) => i.code.split('\n')[0].slice(0, 80),
  matchKey: (i) => i.code,
  async run(input, { ws, signal }) {
    const r = await python.run(ws, input.code, {
      timeoutMs: Math.min(input.timeout ?? 120_000, 600_000),
      signal,
      argv: ['<python-tool>'],
    })
    const parts = [r.stdout && truncate(r.stdout.replace(/\n$/, ''), MAX_OUTPUT)]
    if (r.result !== undefined) parts.push(`→ ${truncate(r.result, 5000)}`)
    if (r.stderr) parts.push(truncate(r.stderr.replace(/\n$/, ''), MAX_OUTPUT / 2))
    if (!r.ok && r.error && !r.stderr.includes(r.error)) parts.push(r.error)
    if (r.changedFiles.length) parts.push(`[files changed: ${r.changedFiles.join(', ')}]`)
    return {
      content: parts.filter(Boolean).join('\n') || '(no output)',
      isError: !r.ok,
      display: { kind: 'code', language: 'python', code: input.code, stdout: r.stdout, stderr: r.stderr + (r.ok ? '' : (r.error ?? '')), result: r.result, ok: r.ok },
    }
  },
}

export const JavaScriptTool: ToolDef<{ code: string; timeout?: number }> = {
  name: 'JavaScript',
  description: `Runs JavaScript (async function body) in an isolated Web Worker with no network access.
- console.log output is returned. Use "return value" to return a result.
- Async filesystem API over the workspace: await fs.readFile(path), await fs.writeFile(path, text), await fs.list(dir), await fs.exists(path), await fs.remove(path).
- await host.exec(command) runs a command in the virtual bash and returns {stdout, stderr, exitCode}.
- No DOM, no fetch, no imports. timeout in milliseconds (default 30000).`,
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code (body of an async function)' },
      timeout: { type: 'number', description: 'Timeout in milliseconds' },
    },
    required: ['code'],
  },
  readOnly: false,
  permission: 'exec',
  summarize: (i) => i.code.split('\n')[0].slice(0, 80),
  matchKey: (i) => i.code,
  async run(input, { ws, signal }) {
    const r = await runJavaScript(ws, input.code, { timeoutMs: Math.min(input.timeout ?? 30_000, 300_000), signal })
    const parts = [r.stdout && truncate(r.stdout.replace(/\n$/, ''), MAX_OUTPUT)]
    if (r.result !== undefined) parts.push(`→ ${truncate(r.result, 5000)}`)
    if (r.stderr) parts.push(truncate(r.stderr.replace(/\n$/, ''), MAX_OUTPUT / 2))
    if (r.error) parts.push(r.error)
    return {
      content: parts.filter(Boolean).join('\n') || '(no output)',
      isError: !r.ok,
      display: { kind: 'code', language: 'javascript', code: input.code, stdout: r.stdout, stderr: r.stderr + (r.error ?? ''), result: r.result, ok: r.ok },
    }
  },
}

export const execTools = [BashTool, BashOutputTool, KillShellTool, PythonTool, JavaScriptTool]
