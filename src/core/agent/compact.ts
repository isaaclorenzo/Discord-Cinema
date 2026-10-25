// Compactación: resume la conversación con el propio modelo y archiva el
// historial anterior (sigue visible en la UI, pero ya no se envía).

import { getAdapter } from '../providers'
import type { GenParams, ModelInfo, ProviderConfig } from '../providers/types'
import type { ChatMessage } from '../types'
import { estimateTokens, truncate, uid } from '../util'

export function transcriptOf(messages: ChatMessage[]): string {
  return messages
    .filter((m) => !m.archived && !m.error && !m.local)
    .map((m) => {
      if (m.role === 'user') return `USER: ${m.content}`
      if (m.role === 'tool') return `TOOL RESULT (${m.toolName}): ${truncate(m.content, 3000)}`
      const calls = m.toolCalls?.map((c) => `\n[called ${c.name} ${truncate(JSON.stringify(c.input), 1500)}]`).join('') ?? ''
      return `ASSISTANT: ${m.content}${calls}`
    })
    .join('\n\n')
}

export function estimateContextTokens(system: string, messages: ChatMessage[]): number {
  return estimateTokens(system) + messages.filter((m) => !m.archived && !m.error && !m.local).reduce((n, m) => n + estimateTokens(m.content) + estimateTokens(JSON.stringify(m.toolCalls ?? '')) + (m.images?.length ?? 0) * 1500, 0)
}

const SUMMARY_PROMPT = `Summarize the conversation so far so that work can continue in a fresh context. Include:
1. The user's goals and explicit requests (quote important constraints).
2. Key decisions and what has been done, with file paths created or modified in /workspace.
3. Errors found and how they were resolved.
4. Pending tasks and the exact next step.
Be precise and complete but concise. Write the summary in the same language the user used.`

export async function summarizeConversation(opts: {
  provider: ProviderConfig
  apiKey: string
  model: ModelInfo
  params: GenParams
  messages: ChatMessage[]
  instructions?: string
  signal: AbortSignal
}): Promise<string> {
  const adapter = getAdapter(opts.provider, { ...opts.model, toolMode: 'none' })
  const transcript = truncate(transcriptOf(opts.messages), 400_000)
  let out = ''
  for await (const ev of adapter.stream({
    provider: opts.provider,
    apiKey: opts.apiKey,
    model: opts.model,
    system: 'You write precise conversation summaries for handoff between AI agents.',
    messages: [
      {
        id: uid('m'),
        role: 'user',
        content: `${SUMMARY_PROMPT}${opts.instructions ? `\nAlso: ${opts.instructions}` : ''}\n\n<conversation>\n${transcript}\n</conversation>`,
        createdAt: Date.now(),
      },
    ],
    tools: [],
    params: { ...opts.params, maxTokens: Math.min(opts.params.maxTokens || 8000, 8000) },
    signal: opts.signal,
    label: `${opts.provider.name} · compactar`,
  })) {
    if (ev.type === 'text') out += ev.text
  }
  return out.trim()
}

export function compactedHistory(messages: ChatMessage[], summary: string): ChatMessage[] {
  return [
    ...messages.map((m) => (m.archived ? m : { ...m, archived: true })),
    {
      id: uid('m'),
      role: 'user',
      content: `This session continues from an earlier conversation that was compacted. Summary of everything so far:\n\n${summary}`,
      synthetic: true,
      createdAt: Date.now(),
      meta: { isCompactSummary: true },
    },
  ]
}
