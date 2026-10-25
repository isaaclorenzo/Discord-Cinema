import { describe, expect, it } from 'vitest'
import { explainProviderError } from '../src/core/providers/errors'

describe('explicación de errores del proveedor', () => {
  it('distingue problemas de cuenta de límites temporales', () => {
    const orca = explainProviderError('Personalizado respondió 429: Free models are not available to this account yet. add credits to use paid access')
    expect(orca.title).toBe('Tu cuenta del proveedor no tiene acceso')
    expect(orca.accountIssue).toBe(true)
    expect(explainProviderError('X respondió 429: rate limit exceeded').title).toBe('Límite de peticiones')
    expect(explainProviderError('X respondió 401: invalid api key').title).toBe('Clave rechazada')
    expect(explainProviderError('X respondió 404: model not found').title).toBe('Modelo o URL no encontrados')
    expect(explainProviderError('X respondió 400: tools are not supported').title).toBe('El modelo no acepta herramientas')
    expect(explainProviderError('Failed to fetch (posible bloqueo CORS)').title).toBe('No se pudo conectar')
    expect(explainProviderError('X respondió 503: overloaded').title).toBe('Fallo temporal del proveedor')
  })
})
