import { Workspace } from '../src/core/sandbox/workspace'
import type { AgentServices, ToolContext } from '../src/core/tools/types'
import type { TodoItem } from '../src/core/types'

export async function makeWorkspace(files: Record<string, string> = {}): Promise<Workspace> {
  const ws = await Workspace.create(`test-${Math.random().toString(36).slice(2)}`)
  for (const [p, c] of Object.entries(files)) await ws.writeFile(p, c, { silent: true })
  ws.readState.clear()
  return ws
}

export function fakeAgent(overrides: Partial<AgentServices> = {}): AgentServices {
  let todos: TodoItem[] = []
  let mode: ReturnType<AgentServices['getMode']> = 'default'
  return {
    getTodos: () => todos,
    setTodos: (t) => (todos = t),
    askUser: async (qs) => Object.fromEntries(qs.map((q) => [q.question, q.options[0].label])),
    requestPlanApproval: async () => ({ approved: true }),
    getMode: () => mode,
    setMode: (m) => (mode = m),
    runSubagent: async () => 'informe',
    loadSkill: async () => ({ error: 'no skills' }),
    runSlashCommand: async () => ({ error: 'no commands' }),
    fetchPage: async () => {
      throw new Error('sin red en tests')
    },
    webSearch: async () => [],
    summarize: async (c) => c,
    preview: async () => {},
    shells: new Map(),
    ...overrides,
  }
}

export function ctx(ws: Workspace, agent = fakeAgent()): ToolContext {
  return {
    ws,
    sessionId: 's1',
    toolCallId: 't1',
    signal: new AbortController().signal,
    agent,
    progress: () => {},
  }
}
