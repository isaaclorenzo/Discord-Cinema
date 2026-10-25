import type { ChatMessage } from '../core/types'
import type { Session } from '../state/sessions'

export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }))
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function exportSessionMarkdown(session: Session, messages: ChatMessage[]): string {
  const lines = [`# ${session.title}`, '', `_Modelo: ${session.modelRef} · ${new Date(session.createdAt).toLocaleString('es')}_`, '']
  for (const m of messages) {
    if (m.local) continue
    if (m.role === 'user') lines.push(`## Usuario${m.synthetic ? ' (contexto)' : ''}`, '', m.content, '')
    else if (m.role === 'assistant') {
      if (m.error) {
        lines.push(`> **Error:** ${m.error.message}`, '')
        continue
      }
      lines.push('## Asistente', '')
      if (m.reasoning) lines.push('<details><summary>Razonamiento</summary>', '', m.reasoning, '', '</details>', '')
      if (m.content) lines.push(m.content, '')
      for (const c of m.toolCalls ?? []) lines.push(`**→ ${c.name}**`, '```json', JSON.stringify(c.input, null, 2), '```', '')
    } else {
      lines.push(`**← ${m.toolName}${m.isError ? ' (error)' : ''}**`, '```', m.content.slice(0, 5000), '```', '')
    }
  }
  return lines.join('\n')
}

export function exportSessionJson(session: Session, messages: ChatMessage[]): string {
  return JSON.stringify({ format: 'glasshouse-session', version: 1, session, messages }, null, 2)
}
