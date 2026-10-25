// Herramientas de orquestación: TodoWrite, Task (sub-agentes), AskUserQuestion,
// modo plan, Skill, SlashCommand y Preview.

import type { TodoItem } from '../types'
import { errorResult, type Question, type ToolDef } from './types'

export const TodoWriteTool: ToolDef<{ todos: TodoItem[] }> = {
  name: 'TodoWrite',
  description: `Creates and manages a structured task list for the current session; the user sees it live.

Use it for multi-step tasks (3+ steps), when the user gives several tasks, or to plan non-trivial work. Skip it for single trivial tasks.
Rules:
- Send the complete list every time (it replaces the previous one).
- Each item: content (imperative, e.g. "Run tests"), activeForm (present continuous, e.g. "Running tests"), status: pending | in_progress | completed.
- Keep exactly one task in_progress while working. Mark tasks completed immediately when done, only if fully done.`,
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 1 },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string' },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => `${i.todos?.filter((t) => t.status === 'completed').length ?? 0}/${i.todos?.length ?? 0} tareas`,
  async run(input, { agent }) {
    if (!Array.isArray(input.todos)) return errorResult('todos must be an array')
    const todos = input.todos.map((t) => ({
      content: String(t.content ?? ''),
      status: (['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending') as TodoItem['status'],
      activeForm: t.activeForm ? String(t.activeForm) : undefined,
    }))
    agent.setTodos(todos)
    return {
      content: 'Todos have been modified successfully. Keep using the todo list to track progress and proceed with the current tasks.',
      display: { kind: 'todos', todos },
    }
  },
}

export interface AgentDescriptor {
  name: string
  description: string
}

export function makeTaskTool(agents: AgentDescriptor[]): ToolDef<{ description: string; prompt: string; subagent_type: string }> {
  const list = agents.map((a) => `- ${a.name}: ${a.description}`).join('\n')
  return {
    name: 'Task',
    description: `Launches a sub-agent that works autonomously on a task with its own fresh context and returns a single final report.

Available agent types:
${list}

Usage:
- The sub-agent cannot see this conversation: write a complete, self-contained prompt (goal, relevant paths, what to return).
- Launch several Task calls in one message to run them in parallel.
- The result is not shown to the user; summarize what matters.
- Use it for broad searches or independent sub-tasks that would otherwise fill your context.`,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short (3-5 word) description of the task' },
        prompt: { type: 'string', description: 'The full task for the agent' },
        subagent_type: { type: 'string', enum: agents.map((a) => a.name), description: 'Type of agent to use' },
      },
      required: ['description', 'prompt', 'subagent_type'],
    },
    readOnly: true,
    permission: 'none',
    summarize: (i) => `${i.subagent_type}: ${i.description}`,
    async run(input, { agent, signal, progress }) {
      if (!agents.some((a) => a.name === input.subagent_type)) {
        return errorResult(`Unknown subagent_type "${input.subagent_type}". Available: ${agents.map((a) => a.name).join(', ')}`)
      }
      try {
        const report = await agent.runSubagent({
          agentType: input.subagent_type,
          description: input.description,
          prompt: input.prompt,
          signal,
          onUpdate: progress,
        })
        return { content: report || '(the sub-agent returned no text)' }
      } catch (e) {
        return errorResult(`Sub-agent failed: ${(e as Error).message}`)
      }
    },
  }
}

export const AskUserQuestionTool: ToolDef<{ questions: Question[] }> = {
  name: 'AskUserQuestion',
  description: `Asks the user 1-4 multiple-choice questions and waits for the answers.
- Use it when you need a decision or clarification you cannot infer.
- Each question: question (ends with "?"), header (max 12 chars), options (2-4, each with label and optional description), multiSelect.
- The user can always pick "Other" and type free text.
- If you recommend an option, put it first and add "(Recommended)" to its label.`,
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            header: { type: 'string' },
            multiSelect: { type: 'boolean' },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              items: {
                type: 'object',
                properties: { label: { type: 'string' }, description: { type: 'string' } },
                required: ['label'],
              },
            },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => i.questions?.[0]?.question ?? '',
  async run(input, { agent }) {
    if (!Array.isArray(input.questions) || input.questions.length === 0) return errorResult('questions is required')
    const answers = await agent.askUser(input.questions)
    const lines = Object.entries(answers).map(([q, a]) => `"${q}" = "${a}"`)
    return {
      content: `User has answered your questions: ${lines.join(', ')}. You can now continue with these answers in mind.`,
      display: { kind: 'questions', questions: input.questions, answers },
    }
  },
}

export const EnterPlanModeTool: ToolDef<Record<string, never>> = {
  name: 'EnterPlanMode',
  description: 'Switches the session to plan mode for complex tasks: only read-only tools are allowed until you present a plan with ExitPlanMode and the user approves it.',
  inputSchema: { type: 'object', properties: {} },
  readOnly: true,
  permission: 'none',
  async run(_input, { agent }) {
    agent.setMode('plan')
    return {
      content:
        'Entered plan mode. Explore with read-only tools, design an approach, then call ExitPlanMode with the plan. Do not edit files or run commands with side effects until the plan is approved.',
    }
  },
}

export const ExitPlanModeTool: ToolDef<{ plan: string }> = {
  name: 'ExitPlanMode',
  description: 'Use in plan mode once your implementation plan is ready: presents the plan (markdown) to the user for approval. Only for tasks that require writing code or making changes.',
  inputSchema: {
    type: 'object',
    properties: { plan: { type: 'string', description: 'The plan, in concise markdown' } },
    required: ['plan'],
  },
  readOnly: true,
  permission: 'none',
  summarize: () => 'Plan para aprobar',
  async run(input, { agent }) {
    const r = await agent.requestPlanApproval(input.plan)
    if (r.approved) {
      if (agent.getMode() === 'plan') agent.setMode('acceptEdits')
      return {
        content: 'User has approved your plan. You can now start coding. Start by updating your todo list if applicable.',
        display: { kind: 'plan', plan: input.plan, approved: true },
      }
    }
    return {
      content: `The user did not approve the plan.${r.feedback ? ` Feedback: ${r.feedback}` : ''} Stay in plan mode, revise the plan and present it again.`,
      display: { kind: 'plan', plan: input.plan, approved: false, feedback: r.feedback },
    }
  },
}

export interface SkillDescriptor {
  name: string
  description: string
}

export function makeSkillTool(skills: SkillDescriptor[]): ToolDef<{ skill: string; args?: string }> {
  const list = skills.length ? skills.map((s) => `- ${s.name}: ${s.description}`).join('\n') : '(no skills installed)'
  return {
    name: 'Skill',
    description: `Loads a skill: a packaged set of expert instructions (and optional files) for a type of task.
When a task matches a skill's description, call this tool first and then follow the loaded instructions.

Available skills:
${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Skill name' },
        args: { type: 'string', description: 'Optional arguments' },
      },
      required: ['skill'],
    },
    readOnly: true,
    permission: 'none',
    summarize: (i) => i.skill,
    async run(input, { agent }) {
      const r = await agent.loadSkill(input.skill, input.args)
      if ('error' in r) return errorResult(r.error)
      return { content: r.content, display: { kind: 'text', title: `Skill: ${input.skill}`, text: r.content } }
    },
  }
}

export function makeSlashCommandTool(commands: Array<{ name: string; description: string }>): ToolDef<{ command: string }> {
  const list = commands.length ? commands.map((c) => `- /${c.name}: ${c.description}`).join('\n') : '(none)'
  return {
    name: 'SlashCommand',
    description: `Runs a custom slash command (a saved prompt template) and returns its expanded instructions, which you must then follow.

Available commands:
${list}`,
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The command with arguments, e.g. "/review src/app.py"' } },
      required: ['command'],
    },
    readOnly: true,
    permission: 'none',
    summarize: (i) => i.command,
    async run(input, { agent }) {
      const r = await agent.runSlashCommand(input.command)
      if ('error' in r) return errorResult(r.error)
      return { content: r.content }
    },
  }
}

export const PreviewTool: ToolDef<{ path?: string; html?: string; title?: string }> = {
  name: 'Preview',
  description: `Renders an HTML page for the user in the preview panel (sandboxed iframe, no network, no access to the app).
- Pass path to an .html file in the workspace (relative CSS/JS files in the workspace are inlined), or html with the full page.
- Use it to show web pages, visualizations, games or UI prototypes you built.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of an HTML file in the workspace' },
      html: { type: 'string', description: 'Full HTML document' },
      title: { type: 'string' },
    },
  },
  readOnly: true,
  permission: 'none',
  summarize: (i) => i.path ?? i.title ?? 'HTML',
  validate: (i) => (i.path || i.html ? null : 'Provide path or html'),
  async run(input, { agent }) {
    await agent.preview(input)
    return { content: 'The preview is now visible to the user.', display: { kind: 'preview', path: input.path, title: input.title } }
  },
}

export const staticAgentTools = [TodoWriteTool, AskUserQuestionTool, EnterPlanModeTool, ExitPlanModeTool, PreviewTool]
