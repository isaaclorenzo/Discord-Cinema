import { describe, expect, it } from 'vitest'
import { toLocalMessages, WEBLLM_MODELS } from '../src/core/providers/webllm'
import { toPromptMessages } from '../src/core/providers/prompt-tools'
import { buildToolset, compactToolset } from '../src/core/tools/registry'
import type { ChatMessage } from '../src/core/types'

const msg = (role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: Math.random().toString(), role, content, createdAt: 0, ...extra })

describe('modelos locales (WebLLM)', () => {
  it('convierte el historial a turnos alternos que terminan en user', () => {
    const history = toPromptMessages([
      msg('user', 'hola'),
      msg('user', 'contexto extra', { synthetic: true }),
      msg('assistant', 'leo', { toolCalls: [{ id: 't1', name: 'Read', input: { file_path: 'a' } }] }),
      msg('tool', 'contenido', { toolCallId: 't1', toolName: 'Read' }),
    ])
    const out = toLocalMessages('SYS', history)
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(out[1].content).toContain('hola')
    expect(out[1].content).toContain('contexto extra')
    expect(out[2].content).toContain('<tool_call>')
    expect(out[3].content).toContain('<tool_result name="Read"')
  })

  it('usa tool-calling por prompt y un juego reducido de herramientas', () => {
    expect(WEBLLM_MODELS.every((m) => m.toolMode === 'prompt' && m.compactTools && (m.contextWindow ?? 0) >= 8192)).toBe(true)
    const all = buildToolset({ agents: [{ name: 'Explore', description: 'x' }], skills: [], commands: [] })
    const compact = compactToolset(all)
    expect(compact.length).toBeLessThan(all.length)
    expect(compact.map((t) => t.name)).toContain('Bash')
    expect(compact.every((t) => t.description.length <= 240 && !t.description.includes('\n'))).toBe(true)
    const promptSize = JSON.stringify(compact.map((t) => [t.name, t.description, t.inputSchema])).length
    expect(promptSize).toBeLessThan(12_000)
  })
})
