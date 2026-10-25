import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { expandCommand, parseSlash } from '../src/core/extensions/commands'
import { runHooks } from '../src/core/extensions/hooks'
import { exportBundle, parseBundle, parseGithubUrl, pluginsFromFiles, unzipToFiles } from '../src/core/extensions/plugins'
import { parseSkillMd, skillToMarkdown } from '../src/core/extensions/skills'
import { BUILTIN_PLUGINS, BUILTIN_SKILLS } from '../src/builtin'
import { makeWorkspace } from './helpers'

const CC_PLUGIN = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo-plugin', version: '1.2.0', description: 'Plugin de prueba', author: { name: 'Ana' } }),
  'commands/hello.md': '---\ndescription: Saluda\nargument-hint: <nombre>\n---\nSaluda a $ARGUMENTS',
  'commands/git/status.md': 'Muestra el estado',
  'agents/reviewer.md': '---\nname: reviewer\ndescription: Revisa código\ntools: Read, Grep\n---\nYou review code.',
  'skills/pdf/SKILL.md': '---\nname: pdf-tools\ndescription: Trabaja con PDFs\nallowed-tools: Read, Bash\n---\n# PDF\nLee reference.md',
  'skills/pdf/reference.md': 'Referencia larga',
  'hooks/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/check.sh' }] }], Notification: [{ hooks: [{ type: 'command', command: 'x' }] }] } }),
  'scripts/check.sh': 'exit 0',
  '.mcp.json': JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'https://mcp.example.com/mcp' }, local: { command: 'npx', args: ['server'] } } }),
}

describe('importación de plugins de Claude Code', () => {
  it('lee la estructura completa', () => {
    const [p] = pluginsFromFiles(CC_PLUGIN, 'x')
    expect(p.name).toBe('demo-plugin')
    expect(p.version).toBe('1.2.0')
    expect(p.author).toBe('Ana')
    expect(p.commands.map((c) => c.name).sort()).toEqual(['git:status', 'hello'])
    expect(p.commands.find((c) => c.name === 'hello')?.argumentHint).toBe('<nombre>')
    expect(p.agents[0]).toMatchObject({ name: 'reviewer', tools: ['Read', 'Grep'], systemPrompt: 'You review code.' })
    expect(p.skills[0]).toMatchObject({ name: 'pdf-tools', allowedTools: ['Read', 'Bash'], files: { 'reference.md': 'Referencia larga' } })
    expect(p.hooks).toHaveLength(1)
    expect(p.hooks[0]).toMatchObject({ event: 'PreToolUse', matcher: 'Bash', pluginRoot: '/plugins/demo-plugin' })
    expect(p.mcpServers).toHaveLength(1)
    expect(p.mcpServers[0]).toMatchObject({ name: 'remote', transport: 'http', enabled: false })
    expect(p.warnings.some((w) => w.includes('stdio'))).toBe(true)
    expect(p.warnings.some((w) => w.includes('Notification'))).toBe(true)
  })

  it('descomprime zips de GitHub y quita la carpeta raíz', () => {
    const entries = Object.fromEntries(Object.entries(CC_PLUGIN).map(([k, v]) => [`repo-main/${k}`, strToU8(v)]))
    const files = unzipToFiles(zipSync(entries))
    expect(files['.claude-plugin/plugin.json']).toBeDefined()
    expect(pluginsFromFiles(files, 'repo')[0].name).toBe('demo-plugin')
  })

  it('entiende marketplaces con varios plugins', () => {
    const files: Record<string, string> = {
      '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'a', source: './plugins/a' }, { name: 'b', source: './plugins/b' }] }),
      'plugins/a/.claude-plugin/plugin.json': '{"name":"a"}',
      'plugins/a/commands/x.md': 'X',
      'plugins/b/.claude-plugin/plugin.json': '{"name":"b"}',
      'plugins/b/skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\nbody',
    }
    const ps = pluginsFromFiles(files, 'm')
    expect(ps.map((p) => p.name)).toEqual(['a', 'b'])
    expect(ps[1].skills[0].name).toBe('s')
  })

  it('importa carpetas que solo tienen skills', () => {
    const ps = pluginsFromFiles({ 'my-skill/SKILL.md': '---\nname: my-skill\ndescription: hace cosas\n---\nPasos' }, 'pack')
    expect(ps[0].skills[0].name).toBe('my-skill')
  })

  it('bundle JSON de ida y vuelta', () => {
    const [p] = pluginsFromFiles(CC_PLUGIN, 'x')
    const again = parseBundle(JSON.parse(exportBundle(p)))
    expect(again.commands.length).toBe(p.commands.length)
    expect(again.skills[0].files).toEqual(p.skills[0].files)
    expect(again.hooks[0].command).toBe(p.hooks[0].command)
  })

  it('reconoce URLs de GitHub', () => {
    expect(parseGithubUrl('https://github.com/anthropics/skills')).toEqual({ owner: 'anthropics', repo: 'skills', ref: undefined, path: undefined })
    expect(parseGithubUrl('https://github.com/a/b/tree/dev/skills/pdf')).toEqual({ owner: 'a', repo: 'b', ref: 'dev', path: 'skills/pdf' })
    expect(parseGithubUrl('https://example.com/a/b')).toBeNull()
  })
})

describe('skills', () => {
  it('parsea y serializa SKILL.md', () => {
    const s = parseSkillMd('---\nname: Mi Skill\ndescription: "Hace: cosas"\n---\n\nCuerpo', { source: 'user' })
    expect(s.name).toBe('mi-skill')
    expect(s.description).toBe('Hace: cosas')
    expect(parseSkillMd(skillToMarkdown(s), { source: 'user' }).description).toBe('Hace: cosas')
  })
  it('tolera descripciones con dos puntos sin comillas', () => {
    const s = parseSkillMd('---\nname: tdd\ndescription: Test-driven development: write a failing test first.\nallowed-tools: Read, Bash\n---\nBody', { source: 'user' })
    expect(s.description).toBe('Test-driven development: write a failing test first.')
    expect(s.allowedTools).toEqual(['Read', 'Bash'])
  })
  it('las skills y plugins de serie son válidos', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(10)
    for (const s of BUILTIN_SKILLS) {
      expect(s.description.length, s.name).toBeGreaterThan(20)
      expect(s.body.startsWith(s.description), s.name).toBe(false)
      expect(s.body.length, s.name).toBeGreaterThan(100)
    }
    expect(BUILTIN_PLUGINS.map((p) => p.name)).toEqual(['dev-workflow', 'research-pack', 'safety-pack', 'toolbox'])
  })
})

describe('comandos personalizados', () => {
  it('expande argumentos, comandos y archivos', async () => {
    const ws = await makeWorkspace({ 'notes.txt': 'contenido de notas' })
    const text = await expandCommand(
      { id: 'c', name: 'x', description: '', template: 'Revisa $1 con modo $2. Todo: $ARGUMENTS. Lista: !`ls`. Archivo @notes.txt', source: 'user', enabled: true },
      'a.py "muy estricto"',
      ws,
    )
    expect(text).toContain('Revisa a.py con modo muy estricto')
    expect(text).toContain('Todo: a.py "muy estricto"')
    expect(text).toContain('Lista: notes.txt')
    expect(text).toContain('<file path="/workspace/notes.txt">\ncontenido de notas')
  })
  it('parsea /comando args', () => {
    expect(parseSlash('/review src/app.py')).toEqual({ name: 'review', args: 'src/app.py' })
    expect(parseSlash('/git:status')).toEqual({ name: 'git:status', args: '' })
    expect(parseSlash('hola')).toBeNull()
  })
})

describe('hooks', () => {
  const safety = BUILTIN_PLUGINS.find((p) => p.name === 'safety-pack')!.hooks

  it('bloqueo declarativo de comandos destructivos', async () => {
    const ws = await makeWorkspace()
    const r = await runHooks(safety, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, ws, 'Bash')
    expect(r.block).toMatch(/destructivo/)
    const ok = await runHooks(safety.filter((h) => h.type !== 'js'), 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, ws, 'Bash')
    expect(ok.block).toBeUndefined()
  })

  it('hooks de comando estilo Claude Code (stdin JSON, exit 2)', async () => {
    const ws = await makeWorkspace()
    const r = await runHooks(safety.filter((h) => h.type === 'command'), 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'curl https://evil.com' } }, ws, 'Bash')
    expect(r.block).toMatch(/no network/)
    const ok = await runHooks(safety.filter((h) => h.type === 'command'), 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls -la' } }, ws, 'Bash')
    expect(ok.block).toBeUndefined()
  })

  it('JSON en stdout y contexto adicional', async () => {
    const ws = await makeWorkspace()
    const hooks = [
      { id: 'h1', event: 'PostToolUse' as const, matcher: 'Read', type: 'command' as const, command: `echo '{"additionalContext":"recuerda X"}'`, source: 'user' as const, enabled: true },
      { id: 'h2', event: 'PostToolUse' as const, matcher: 'Write', type: 'command' as const, command: `echo '{"decision":"block","reason":"no"}'`, source: 'user' as const, enabled: true },
    ]
    expect((await runHooks(hooks, 'PostToolUse', { tool_name: 'Read' }, ws, 'Read')).context).toBe('recuerda X')
    expect((await runHooks(hooks, 'PostToolUse', { tool_name: 'Write' }, ws, 'Write')).block).toBe('no')
    expect(await runHooks(hooks, 'PostToolUse', { tool_name: 'Bash' }, ws, 'Bash')).toEqual({})
  })
})
