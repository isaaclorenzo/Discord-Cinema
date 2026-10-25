import type { AgentDef } from './types'

const READ_ONLY = ['Read', 'Glob', 'Grep', 'LS', 'Bash', 'BashOutput', 'WebFetch', 'WebSearch', 'TodoWrite', 'Skill']

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    id: 'builtin:general-purpose',
    name: 'general-purpose',
    description: 'General agent for researching complex questions, searching code and executing multi-step tasks autonomously.',
    systemPrompt:
      'You are a capable sub-agent. Complete the task you were given using the available tools, then reply with a concise, complete report of what you found or did (include relevant paths and results). Do not ask the user questions.',
    source: 'builtin',
    enabled: true,
  },
  {
    id: 'builtin:explore',
    name: 'Explore',
    description: 'Fast read-only agent to find files, search code and answer questions about the workspace. Cannot modify files.',
    systemPrompt:
      'You are a read-only exploration sub-agent. Use Glob, Grep, Read, LS and read-only Bash commands to answer the question. Never modify files. Reply with a focused report: the answer, key file paths and short excerpts.',
    tools: READ_ONLY,
    source: 'builtin',
    enabled: true,
  },
  {
    id: 'builtin:plan',
    name: 'Plan',
    description: 'Software architect agent: explores the workspace read-only and returns a step-by-step implementation plan.',
    systemPrompt:
      'You are a planning sub-agent. Explore the workspace read-only, then return a concrete implementation plan: steps, files to create or change, risks and how to verify. Do not modify files.',
    tools: READ_ONLY,
    source: 'builtin',
    enabled: true,
  },
]
