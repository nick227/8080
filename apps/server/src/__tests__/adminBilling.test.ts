import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, testUserId, testOtherUserId, validateResponse } from './helpers'
import { STRIPE_READ_VERSION } from '../services/admin/billing'

const app = buildTestApp()
const fetchMock = vi.fn()
beforeEach(async () => {
  vi.stubEnv('STRIPE_READONLY_KEY', '')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  await db.platformStaff.create({ data: { userId: testUserId, role: 'platform_owner', grantedById: 'test' } })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const get = (query = '', user = testUserId) => app.inject({ url: `/admin/subscriptions${query}`, headers: asAuth(user) })
const subscription = (extra: Record<string,unknown> = {}) => ({
  id: 'sub_demo', livemode: false, status: 'active', customer: 'cus_demo', metadata: { '8080_user_id': testUserId },
  cancel_at_period_end: true, cancel_at: null, ended_at: null,
  items: { data: [{ current_period_end: 1800000000, price: { recurring: { interval: 'month', interval_count: 1 } } }] },
  latest_invoice: { status: 'open' }, ...extra,
})
describe('read-only Stripe billing', () => {
  it('shows unconfigured without calling Stripe and denies non-staff', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ configured: false, data: [], mode: null, fetchedAt: null })
    await validateResponse('getAdminSubscriptions', 200, res.json())
    expect((await get('', testOtherUserId)).statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('reads only, separates invoice/subscription status, shows cancellation end and maps exact metadata', async () => {
    vi.stubEnv('STRIPE_READONLY_KEY', 'rk_test_example')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [subscription()], has_more: true })))
    const res = await get('?cursor=sub_previous&status=active')
    expect(res.statusCode).toBe(200)
    await validateResponse('getAdminSubscriptions', 200, res.json())
    const item = res.json().data[0]
    expect(item).toMatchObject({ status: 'active', invoiceStatus: 'open', dateLabel: 'Ends', interval: '1 month', user: { id: testUserId }, dashboardUrl: 'https://dashboard.stripe.com/test/subscriptions/sub_demo' })
    expect(res.json().nextCursor).toBe('sub_demo')
    const [url, options] = fetchMock.mock.calls[0]!
    expect(new URL(url).searchParams.get('starting_after')).toBe('sub_previous')
    expect(new URL(url).searchParams.get('expand[]')).toBe('data.latest_invoice')
    expect(options.method).toBe('GET')
    expect(options.headers['Stripe-Version']).toBe(STRIPE_READ_VERSION)
    expect(await db.premiumGrant.count()).toBe(0)
    expect(res.body).not.toContain('rk_test_example')
  })
  it('never matches customers by email or claims unknown invoice status is paid', async () => {
    vi.stubEnv('STRIPE_READONLY_KEY', 'rk_test_example')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [subscription({ metadata: {}, latest_invoice: 'in_unexpanded', status: 'canceled', ended_at: 1700000000 })], has_more: false })))
    const res = await get()
    expect(res.json().data[0]).toMatchObject({ user: null, invoiceStatus: null, dateLabel: 'Ended', date: new Date(1700000000*1000).toISOString() })
  })
  it('rejects write-capable keys and sanitizes provider errors', async () => {
    vi.stubEnv('STRIPE_READONLY_KEY', 'sk_live_shouldnotbeused')
    expect((await get()).statusCode).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('STRIPE_READONLY_KEY', 'rk_test_example')
    fetchMock.mockResolvedValue(new Response('sensitive provider payload', { status: 403 }))
    const denied = await get()
    expect(denied.statusCode).toBe(503)
    expect(denied.body).not.toContain('sensitive')
    fetchMock.mockRejectedValue(new Error('request contains rk_test_example'))
    const failed = await get()
    expect(failed.statusCode).toBe(502)
    expect(failed.body).not.toContain('rk_test_example')
  })
  it('rejects malformed and mismatched-mode responses', async () => {
    vi.stubEnv('STRIPE_READONLY_KEY', 'rk_test_example')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [subscription({ livemode: true })], has_more: false })))
    expect((await get()).statusCode).toBe(502)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: null })))
    expect((await get()).statusCode).toBe(502)
  })
})
