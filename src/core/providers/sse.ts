// Parser incremental de Server-Sent Events.

export interface SseEvent {
  event?: string
  data: string
}

export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event: string | undefined
  let data: string[] = []
  const flush = (): SseEvent | null => {
    if (data.length === 0) {
      event = undefined
      return null
    }
    const ev = { event, data: data.join('\n') }
    event = undefined
    data = []
    return ev
  }
  try {
    for (;;) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1))
        if (line === '') {
          const ev = flush()
          if (ev) yield ev
        } else if (line.startsWith(':')) {
          continue
        } else {
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          let val = colon < 0 ? '' : line.slice(colon + 1)
          if (val.startsWith(' ')) val = val.slice(1)
          if (field === 'data') data.push(val)
          else if (field === 'event') event = val
        }
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        else if (line.startsWith('event:')) event = line.slice(6).trim()
      }
    }
    const last = flush()
    if (last) yield last
  } finally {
    reader.releaseLock()
  }
}

/**
 * Separa bloques <think>…</think> del texto en streaming (modelos que mezclan
 * el razonamiento con la respuesta: algunos despliegues de DeepSeek-R1, Qwen, MiniMax).
 */
export class ThinkSplitter {
  private inThink = false
  private pending = ''
  private seenText = false

  push(chunk: string): Array<{ type: 'text' | 'reasoning'; text: string }> {
    const out: Array<{ type: 'text' | 'reasoning'; text: string }> = []
    let s = this.pending + chunk
    this.pending = ''
    while (s.length) {
      if (this.inThink) {
        const i = s.indexOf('</think>')
        if (i >= 0) {
          this.emit(out, 'reasoning', s.slice(0, i))
          this.inThink = false
          s = s.slice(i + 8).replace(/^\s*\n/, '')
          continue
        }
        const keep = partialSuffix(s, '</think>')
        this.emit(out, 'reasoning', s.slice(0, s.length - keep))
        this.pending = s.slice(s.length - keep)
        break
      }
      if (!this.seenText) {
        const i = s.indexOf('<think>')
        if (i >= 0 && s.slice(0, i).trim() === '') {
          this.inThink = true
          s = s.slice(i + 7)
          continue
        }
        if (i < 0 && s.trim() === '') {
          this.pending = s
          break
        }
        const keep = i < 0 ? partialSuffix(s, '<think>') : 0
        if (keep && s.slice(0, s.length - keep).trim() === '') {
          this.pending = s
          break
        }
      }
      this.emit(out, 'text', s)
      break
    }
    return out
  }

  flush(): Array<{ type: 'text' | 'reasoning'; text: string }> {
    const out: Array<{ type: 'text' | 'reasoning'; text: string }> = []
    if (this.pending) this.emit(out, this.inThink ? 'reasoning' : 'text', this.pending)
    this.pending = ''
    return out
  }

  private emit(out: Array<{ type: 'text' | 'reasoning'; text: string }>, type: 'text' | 'reasoning', text: string) {
    if (!text) return
    if (type === 'text' && text.trim()) this.seenText = true
    const last = out[out.length - 1]
    if (last && last.type === type) last.text += text
    else out.push({ type, text })
  }
}

function partialSuffix(s: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
    if (tag.startsWith(s.slice(-k))) return k
  }
  return 0
}
