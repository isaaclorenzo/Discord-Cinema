import { describe, expect, it } from 'vitest'
import { runAgent, guardOutgoing, type ConversationSink, type PermissionPolicy } from '../src/core/agent/loop'
import { buildToolset } from '../src/core/tools/registry'
import { setMockDelay } from '../src/core/providers/mock'
import { providerFromPreset, PRESETS } from '../src/core/providers/presets'
import { DEFAULT_GUARD, GuardBlockedError } from '../src/core/security/guard'
import { netFetch } from '../src/core/net'
import { checkPermission, ruleMatches } from '../src/core/agent/permissions'
import { BashTool } from '../src/core/tools/exec'
import { WebFetchTool } from '../src/core/tools/web'
import { EditTool } from '../src/core/tools/files'
import type { ChatMessage } from '../src/core/types'
import { fakeAgent, makeWorkspace } from './helpers'

setMockDelay(0)

function memorySink(initial: ChatMessage[]): ConversationSink & { all: ChatMessage[] } {
  const all = [...initial]
  return {
    all,
    messages: () => all,
    push: (m) => void all.push(m),
    update: (id, patch) => {
      const i = all.findIndex((m) => m.id === id)
      if (i >= 0) all[i] = typeof patch === 'function' ? patch(all[i]) : { ...all[i], ...patch }
    },
  }
}

const allowAll: PermissionPolicy = {
  getMode: () => 'default',
  getRules: () => ({ allow: [], deny: [] }),
  ask: async () => ({ decision: 'allow' }),
  addAllowRule: () => {},
}

async function run(prompt: string, opts: { permissions?: PermissionPolicy; agent?: ReturnType<typeof fakeAgent> } = {}) {
  const ws = await makeWorkspace({ 'README.md': '# hola' })
  const demo = PRESETS.find((p) => p.id === 'demo')!
  const provider = providerFromPreset(demo, 'demo')
  const sink = memorySink([{ id: 'u1', role: 'user', content: prompt, createdAt: 0 }])
  const tools = buildToolset({ agents: [{ name: 'Explore', description: 'x' }], skills: [], commands: [] })
  const stats = await runAgent({
    sessionId: 's',
    provider,
    apiKey: '',
    model: provider.models[0],
    params: {},
    system: () => 'sys',
    tools: () => tools,
    ws,
    services: opts.agent ?? fakeAgent(),
    permissions: opts.permissions ?? allowAll,
    hooks: { preToolUse: async () => ({}), postToolUse: async () => ({}), stop: async () => ({}) },
    guard: DEFAULT_GUARD,
    maxTurns: 10,
    signal: new AbortController().signal,
    sink,
  })
  return { stats, sink, ws }
}

describe('bucle de agente (proveedor Demo)', () => {
  it('responde sin herramientas', async () => {
    const { stats, sink } = await run('echo: hola mundo')
    expect(stats.finalText).toBe('hola mundo')
    expect(sink.all.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })

  it('ejecuta herramientas y vuelve a llamar al modelo', async () => {
    const { stats, sink } = await run('lista los archivos')
    expect(stats.toolCalls).toBe(1)
    const tool = sink.all.find((m) => m.role === 'tool')!
    expect(tool.toolName).toBe('Glob')
    expect(tool.status).toBe('done')
    expect(stats.finalText).toContain('/workspace/README.md')
  })

  it('el guard bloquea la fuga de un secreto por WebFetch', async () => {
    const agent = fakeAgent({
      fetchPage: async (url) => {
        await netFetch(url, { method: 'GET' }, { purpose: 'webfetch', label: 'WebFetch', via: 'relay' })
        throw new Error('no debería llegar aquí')
      },
    })
    const { sink, stats } = await run('simula una fuga', { agent })
    const fetchResult = sink.all.find((m) => m.role === 'tool' && m.toolName === 'WebFetch')!
    expect(fetchResult.isError).toBe(true)
    expect(fetchResult.content).toMatch(/escudo de privacidad/)
    expect(stats.finalText).toMatch(/Resultado del intento de fuga/)
  })

  it('respeta la denegación del usuario', async () => {
    const deny: PermissionPolicy = { ...allowAll, ask: async () => ({ decision: 'deny', message: 'no' }) }
    const { sink } = await run('simula una fuga', { permissions: deny })
    const write = sink.all.find((m) => m.role === 'tool' && m.toolName === 'Write')!
    expect(write.status).toBe('denied')
    expect(write.content).toMatch(/denied/)
  })
})

describe('guard sobre lo que sale', () => {
  const msgs: ChatMessage[] = [
    { id: '1', role: 'user', content: 'mi clave es sk-abcdefghijklmnopqrstuvwxyz123456 y mi email ana@empresa.com', createdAt: 0 },
    { id: '2', role: 'assistant', content: 'ok sk-abcdefghijklmnopqrstuvwxyz123456', createdAt: 0 },
  ]
  it('bloquea por defecto', () => {
    expect(() => guardOutgoing('', msgs, DEFAULT_GUARD, undefined, 'X')).toThrow(GuardBlockedError)
  })
  it('redacta solo lo que el proveedor no ha visto', () => {
    const r = guardOutgoing('', msgs, { ...DEFAULT_GUARD, action: 'redact' }, undefined, 'X')
    expect(r.messages[0].content).toBe('mi clave es [REDACTED:openai-key] y mi email [REDACTED:email]')
    expect(r.messages[1].content).toContain('sk-')
    expect(r.redactions).toBe(2)
  })
  it('permite si el usuario lo confirma', () => {
    expect(guardOutgoing('', msgs, DEFAULT_GUARD, 'allow', 'X').redactions).toBe(0)
  })
})

describe('permisos', () => {
  it('interpreta reglas al estilo Claude Code', () => {
    expect(ruleMatches('Bash(ls:*)', 'Bash', 'ls -la')).toBe(true)
    expect(ruleMatches('Bash(ls:*)', 'Bash', 'lsof')).toBe(false)
    expect(ruleMatches('Bash(npm test)', 'Bash', 'npm test')).toBe(true)
    expect(ruleMatches('WebFetch(domain:github.com)', 'WebFetch', 'api.github.com')).toBe(true)
    expect(ruleMatches('WebFetch(domain:github.com)', 'WebFetch', 'evilgithub.com')).toBe(false)
    expect(ruleMatches('Edit(/workspace/docs/**)', 'Write', '/workspace/docs/a.md')).toBe(true)
    expect(ruleMatches('mcp__notion', 'mcp__notion__search', undefined)).toBe(true)
  })
  it('aplica modos', () => {
    const rules = { allow: [], deny: [] }
    expect(checkPermission(BashTool, { command: 'ls' }, 'default', rules).behavior).toBe('ask')
    expect(checkPermission(EditTool, { file_path: 'a' }, 'acceptEdits', rules).behavior).toBe('allow')
    expect(checkPermission(WebFetchTool, { url: 'https://a.com' }, 'acceptEdits', rules).behavior).toBe('ask')
    expect(checkPermission(EditTool, { file_path: 'a' }, 'plan', rules).behavior).toBe('deny')
    expect(checkPermission(BashTool, { command: 'rm x' }, 'bypassPermissions', { allow: [], deny: ['Bash(rm:*)'] }).behavior).toBe('deny')
  })
})
