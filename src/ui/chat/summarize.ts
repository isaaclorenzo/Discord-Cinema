import type { TodoItem } from '../../core/types'

/** Resumen de una línea de la entrada de una herramienta, para su tarjeta. */
export function summarizeInput(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (name) {
    case 'Bash':
      return s('command')
    case 'Grep':
      return `/${s('pattern')}/${s('path') ? ` en ${s('path')}` : ''}${s('glob') ? ` (${s('glob')})` : ''}`
    case 'Glob':
      return s('pattern')
    case 'Task':
      return `${s('subagent_type')}: ${s('description')}`
    case 'Python':
    case 'JavaScript':
      return s('code').split('\n')[0]
    case 'TodoWrite': {
      const todos = (input.todos as TodoItem[]) ?? []
      return `${todos.filter((t) => t.status === 'completed').length}/${todos.length} tareas`
    }
    case 'AskUserQuestion':
      return ((input.questions as Array<{ question: string }>) ?? [])[0]?.question ?? ''
    case 'ExitPlanMode':
      return 'Plan para aprobar'
    default:
      return s('file_path') || s('notebook_path') || s('path') || s('url') || s('query') || s('skill') || s('command') || s('title') || ''
  }
}
