import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-4 (G-6 register) — logAuthEvent's failure routing through the
// captureException observability seam, demanded at the 2026-07-23 sign-off
// review (the item had code-inspection-only evidence). Everything framework-
// shaped is factory-mocked so the vitest pure-logic tier never loads Next's
// module graph (see vitest.config.ts).

const captureException = vi.fn()
vi.mock('@/lib/observability/sentry', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}))

const headerStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => headerStore.get(k) ?? null }),
}))

const insertMock = vi.fn()
const createSupabaseServiceRoleClient = vi.fn(() => ({
  from: () => ({ insert: insertMock }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: () => createSupabaseServiceRoleClient(),
}))

import { logAuthEvent } from './events'

beforeEach(() => {
  vi.clearAllMocks()
  headerStore.clear()
  insertMock.mockResolvedValue({ error: null })
})

describe('logAuthEvent — B-4 failure routing', () => {
  it('routes a DB error return through captureException and does not throw', async () => {
    insertMock.mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(
      logAuthEvent('auth.login.failure', { email: 'x@test.local' }),
    ).resolves.toBeUndefined()

    expect(captureException).toHaveBeenCalledTimes(1)
    const [err, context] = captureException.mock.calls[0]
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain(
      'auth-events write failed: permission denied',
    )
    expect(context).toEqual({
      where: 'auth-events:insert',
      event: 'auth.login.failure',
    })
  })

  it('routes a thrown exception through captureException and does not throw', async () => {
    const boom = new Error('fetch failed')
    createSupabaseServiceRoleClient.mockImplementationOnce(() => {
      throw boom
    })

    await expect(
      logAuthEvent('auth.signup.failure'),
    ).resolves.toBeUndefined()

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(boom, {
      where: 'auth-events:insert',
      event: 'auth.signup.failure',
    })
  })

  it('does not invoke the seam on a successful write', async () => {
    await logAuthEvent('auth.login.success', { userId: 'u1' })
    expect(captureException).not.toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalledTimes(1)
  })
})

describe('logAuthEvent — F-2a client-IP provenance', () => {
  it('prefers the platform-attested x-vercel-forwarded-for over a proxied x-forwarded-for', async () => {
    // The review scenario: with a proxy in front of Vercel, x-forwarded-for
    // can carry caller-influenced hops; x-vercel-forwarded-for cannot.
    headerStore.set('x-forwarded-for', '6.6.6.6, 203.0.113.7')
    headerStore.set('x-vercel-forwarded-for', '203.0.113.7')
    headerStore.set('x-real-ip', '203.0.113.7')

    await logAuthEvent('auth.login.failure')
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      client_ip: '203.0.113.7',
    })
  })

  it('falls back to x-forwarded-for first hop, then x-real-ip, else null', async () => {
    headerStore.set('x-forwarded-for', '198.51.100.4, 10.0.0.1')
    await logAuthEvent('auth.login.failure')
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      client_ip: '198.51.100.4',
    })

    headerStore.clear()
    headerStore.set('x-real-ip', '198.51.100.9')
    await logAuthEvent('auth.login.failure')
    expect(insertMock.mock.calls[1][0]).toMatchObject({
      client_ip: '198.51.100.9',
    })

    headerStore.clear()
    await logAuthEvent('auth.login.failure')
    expect(insertMock.mock.calls[2][0]).toMatchObject({ client_ip: null })
  })
})
