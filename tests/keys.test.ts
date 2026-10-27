import { describe, expect, it } from 'vitest'
import { describeKeyMismatch, keyMismatch } from '../src/core/providers/keys'
import { PRESETS } from '../src/core/providers/presets'

describe('claves de otro proveedor', () => {
  it('detecta una clave de OrcaRouter enviada a Token Harbor', () => {
    const m = keyMismatch('sk-orca-abc123', 'https://tokenharbor.ai/v1')
    expect(m).toEqual({ keyProvider: 'OrcaRouter', prefix: 'sk-orca-', host: 'tokenharbor.ai' })
    expect(describeKeyMismatch(m!)).toMatch(/OrcaRouter.*tokenharbor\.ai/)
  })

  it('acepta cada clave en su proveedor y subdominios', () => {
    expect(keyMismatch('sk-orca-abc', 'https://api.orcarouter.ai/v1')).toBeNull()
    expect(keyMismatch('thk_live_abc', 'https://tokenharbor.ai/v1')).toBeNull()
    expect(keyMismatch('sk-or-v1-abc', 'https://openrouter.ai/api/v1')).toBeNull()
    expect(keyMismatch('AIzaSyabc', 'https://generativelanguage.googleapis.com/v1beta/openai')).toBeNull()
  })

  it('no distingue OpenRouter de OrcaRouter por error', () => {
    expect(keyMismatch('sk-orca-abc', 'https://openrouter.ai/api/v1')?.keyProvider).toBe('OrcaRouter')
    expect(keyMismatch('sk-or-v1-abc', 'https://api.orcarouter.ai/v1')?.keyProvider).toBe('OpenRouter')
  })

  it('no avisa con claves genéricas, proxies locales ni dominios parecidos legítimos', () => {
    expect(keyMismatch('sk-1234567890abcdef', 'https://api.deepseek.com/v1')).toBeNull()
    expect(keyMismatch('sk-orca-abc', 'http://localhost:4000/v1')).toBeNull()
    expect(keyMismatch('thk_abc', 'https://tokenharbor.ai.evil.com/v1')?.host).toBe('tokenharbor.ai.evil.com')
  })

  it('los presets de agregadores apuntan a su dominio', () => {
    expect(PRESETS.find((p) => p.id === 'tokenharbor')?.baseUrl).toBe('https://tokenharbor.ai/v1')
    expect(PRESETS.find((p) => p.id === 'orcarouter')?.baseUrl).toBe('https://api.orcarouter.ai/v1')
  })
})
