// Not generated: verifies spec-declared limits (x-fastify-config.rateLimit) are enforced.
import { describe, it, expect } from 'vitest'
import { buildTestApp } from './helpers'

const app = buildTestApp({ rateLimit: true })

describe('rate limits', () => {
  it('limits guest session creation per IP (20/hour)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 21; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/auth/guest', payload: {} })).statusCode)
    }
    expect(codes.slice(0, 20).every((c) => c === 201)).toBe(true)
    expect(codes[20]).toBe(429)
  })
})
