// Agents S0 (docs/agents/07): email presentation, schedules, secrets, the workspace's
// automatic "Send with 8080" sender, providers, and the job runner (prepare → dedupe
// → render → freeze → send → bounded visible retries → finalize → next occurrence).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { db } from '@project/db'
import { emailContentProblems, type EmailContent } from '@project/shared'
import { buildTestApp, validateResponse, testUserId } from './helpers'
import { caller, carolId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'
import { renderEmail } from '../services/agents/presentation'
import { nextOccurrence, recurrenceProblems } from '../lib/recurrence'
import { decryptSecret, encryptSecret } from '../lib/secrets'
import { defaultConnection } from '../services/agents/connections'
import { ResendPlatformProvider } from '../services/agents/email/resendPlatform'
import { describeEmailSetup, emailTransport, parseFrom, platformIdentity, providerFor } from '../services/agents/email'
import { registerAgentType, type EmailRecipient } from '../services/agents/registry'
import { baseValues, workspaceMembers } from '../services/agents/audiences'
import { MAX_ATTEMPTS, RETRY_DELAY_MS, scheduleNext, tick } from '../services/agents/runner'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'

const app = buildTestApp()
const call = caller(app)

const content: EmailContent = {
  version: 1,
  blocks: [
    { type: 'heading', text: 'Hello {{contact.firstName|there}}' },
    { type: 'text', text: 'Line <one> & "two"\n\nSecond paragraph' },
    { type: 'list', items: ['a', 'b'] },
    { type: 'button', label: 'Open', href: 'https://example.com/x?a=1&b=2' },
    { type: 'divider' },
    { type: 'section', title: 'Follow-ups due', lines: ['Call Sarah'], link: { label: 'View', href: 'https://example.com/f' } },
  ],
}

// ─── presentation ──────────────────────────────────────────────────────────────

describe('email presentation', () => {
  const base = { subject: 'News from {{company.name}}', content, theme: 'company' as const, values: { 'company.name': 'Acme', 'contact.firstName': 'Sarah' } }

  it('renders every template × theme with merge values filled and HTML escaped', () => {
    for (const template of ['basic', 'bulletin', 'team_brief'] as const) {
      for (const theme of ['company', 'mono', 'warm'] as const) {
        const out = renderEmail({ ...base, template, theme })
        expect(out.subject).toBe('News from Acme')
        expect(out.html).toContain('Hello Sarah')
        expect(out.html).toContain('Line &lt;one&gt; &amp; &quot;two&quot;')
        expect(out.html).not.toContain('<one>')
        expect(out.html).toContain('href="https://example.com/x?a=1&amp;b=2"')
        expect(out.text).toContain('Open: https://example.com/x?a=1&b=2')
      }
    }
  })

  it('plain text is text-only; fallbacks fill missing values; test copies are marked', () => {
    const out = renderEmail({ ...base, values: { 'company.name': 'Acme' }, template: 'plain', footer: ['Sent by {{company.name}}'], test: true })
    expect(out.html).toBe('')
    expect(out.subject).toBe('[Test] News from Acme')
    expect(out.text).toContain('HELLO THERE')
    expect(out.text).toContain('This is a test.')
    expect(out.text).toContain('- Call Sarah')
    expect(out.text.trim().endsWith('Sent by Acme')).toBe(true)
  })

  it('validates content and rejects merge fields outside the allowlist', () => {
    expect(emailContentProblems(content)).toEqual([])
    expect(emailContentProblems({ version: 1, blocks: [{ type: 'text', text: 'Hi {{contact.password}}' }] })).toEqual(['unknown merge field {{contact.password}}'])
    expect(emailContentProblems({ version: 1, blocks: [{ type: 'button', label: 'x', href: 'javascript:alert(1)' }] })).toHaveLength(1)
    expect(emailContentProblems({ blocks: [] })).toHaveLength(1)
  })
})

// ─── schedules ─────────────────────────────────────────────────────────────────

describe('recurrence', () => {
  const NY = 'America/New_York'
  const at = (iso: string) => new Date(iso)

  it('daily, weekdays only, weekly', () => {
    expect(nextOccurrence({ repeat: 'daily', time: '09:00' }, at('2026-10-07T12:00:00Z'), NY)).toEqual({ at: at('2026-10-07T13:00:00Z'), key: '2026-10-07T09:00' })
    expect(nextOccurrence({ repeat: 'daily', time: '09:00' }, at('2026-10-07T13:00:00Z'), NY)?.key).toBe('2026-10-08T09:00')
    // Fri 2026-10-09 after 9am → Monday
    expect(nextOccurrence({ repeat: 'daily', time: '09:00', weekdaysOnly: true }, at('2026-10-09T14:00:00Z'), NY)?.key).toBe('2026-10-12T09:00')
    expect(nextOccurrence({ repeat: 'weekly', weekday: 1, time: '08:30' }, at('2026-10-07T12:00:00Z'), NY)?.key).toBe('2026-10-12T08:30')
  })

  it('monthly: first Monday, last Friday, last day, a date', () => {
    expect(nextOccurrence({ repeat: 'monthly', nth: 1, weekday: 1, time: '09:00' }, at('2026-10-07T12:00:00Z'), NY)?.key).toBe('2026-11-02T09:00')
    expect(nextOccurrence({ repeat: 'monthly', nth: 'last', weekday: 5, time: '09:00' }, at('2026-10-07T12:00:00Z'), NY)?.key).toBe('2026-10-30T09:00')
    expect(nextOccurrence({ repeat: 'monthly', date: 'last', time: '17:00' }, at('2026-02-10T12:00:00Z'), NY)?.key).toBe('2026-02-28T17:00')
    expect(nextOccurrence({ repeat: 'monthly', date: 15, time: '09:00' }, at('2026-10-15T14:00:00Z'), NY)?.key).toBe('2026-11-15T09:00')
  })

  it('keeps wall-clock time across DST and in zones ahead of UTC', () => {
    // US fall back on 2026-11-01: 09:00 is 13:00Z before, 14:00Z after.
    expect(nextOccurrence({ repeat: 'daily', time: '09:00' }, at('2026-10-31T14:00:00Z'), NY)?.at.toISOString()).toBe('2026-11-01T14:00:00.000Z')
    // Spring forward 2027-03-14: 09:00 EDT = 13:00Z.
    expect(nextOccurrence({ repeat: 'daily', time: '09:00' }, at('2027-03-13T15:00:00Z'), NY)?.at.toISOString()).toBe('2027-03-14T13:00:00.000Z')
    // Auckland (UTC+13): 2026-10-07T20:00Z is already Oct 8, 09:00 local.
    expect(nextOccurrence({ repeat: 'daily', time: '08:00' }, at('2026-10-07T20:00:00Z'), 'Pacific/Auckland')?.key).toBe('2026-10-09T08:00')
  })

  it('one-time schedules end; bad rules are explained', () => {
    expect(nextOccurrence({ repeat: 'once', at: '2026-10-08T10:00' }, at('2026-10-07T12:00:00Z'), NY)?.at.toISOString()).toBe('2026-10-08T14:00:00.000Z')
    expect(nextOccurrence({ repeat: 'once', at: '2026-10-01T10:00' }, at('2026-10-07T12:00:00Z'), NY)).toBeNull()
    expect(recurrenceProblems({ repeat: 'daily', time: '25:00' })).toEqual(['choose a time'])
    expect(recurrenceProblems({ repeat: 'monthly', date: 31, time: '09:00' })).toEqual(['choose a day'])
    expect(recurrenceProblems({ repeat: 'hourly' })).toEqual(['choose how often it repeats'])
  })
})

// ─── secrets ───────────────────────────────────────────────────────────────────

describe('secrets', () => {
  afterEach(() => vi.unstubAllEnvs())
  const key = (b: number) => Buffer.alloc(32, b).toString('base64')

  it('round-trips, rejects tampering, and still opens old secrets after rotation', () => {
    vi.stubEnv('SECRET_KEYS', `k1:${key(1)}`)
    const sealed = encryptSecret({ password: 'hunter2' })
    expect(sealed).not.toContain('hunter2')
    expect(decryptSecret(sealed)).toEqual({ password: 'hunter2' })
    const parts = sealed.split('.')
    parts[4] = Buffer.from('x' + Buffer.from(parts[4]!, 'base64url').toString('latin1').slice(1), 'latin1').toString('base64url')
    expect(() => decryptSecret(parts.join('.'))).toThrow()

    vi.stubEnv('SECRET_KEYS', `k2:${key(2)},k1:${key(1)}`)
    expect(decryptSecret(sealed)).toEqual({ password: 'hunter2' })
    expect(encryptSecret('x').split('.')[1]).toBe('k2')
    vi.stubEnv('SECRET_KEYS', `k2:${key(2)}`)
    expect(() => decryptSecret(sealed)).toThrow(/k1/)
  })
})

// ─── the workspace sender ──────────────────────────────────────────────────────

describe('email connections', () => {
  it('every new workspace gets "Send with 8080" as its default, Reply-To = the creator', async () => {
    await seedPeople()
    const ws = await createWorkspace(app)
    const rows = await db.emailConnection.findMany({ where: { workspaceId: ws.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ strategy: 'platform', defaultFor: ws.id, displayName: 'Acme Co', replyTo: 'alice@test.local', secret: null })

    const res = await call(testUserId, 'GET', `/workspaces/${ws.id}/email-connections`)
    expect(res.statusCode).toBe(200)
    await validateResponse('listEmailConnections', 200, res.json())
    expect(res.json().data).toEqual([
      expect.objectContaining({ mode: 'platform', strategy: 'platform', label: 'Send with 8080', isDefault: true, fromAddress: 'agents@8080.localhost', replyTo: 'alice@test.local', status: 'active' }),
    ])
    expect(JSON.stringify(res.json())).not.toContain('secret')
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('a workspace from before Agents gets its default on first read, exactly once', async () => {
    const ws = await createWorkspace(app)
    await db.emailConnection.deleteMany({ where: { workspaceId: ws.id } })
    const [a, b] = await Promise.all([defaultConnection(ws.id), defaultConnection(ws.id)])
    expect(a.id).toBe(b.id)
    expect(await db.emailConnection.count({ where: { workspaceId: ws.id } })).toBe(1)
    expect(a.replyTo).toBe('alice@test.local')
  })

  it('admins change the name and reply-to; members read only; bad addresses are refused', async () => {
    await seedPeople()
    const ws = await createWorkspace(app)
    await join(app, ws.id, carolId, 'carol@test.local')
    const [conn] = (await call(carolId, 'GET', `/workspaces/${ws.id}/email-connections`)).json().data
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/email-connections/${conn.id}`, { replyTo: 'c@x.com' })).statusCode).toBe(403)
    expect((await call(carolId, 'POST', `/workspaces/${ws.id}/email-connections/${conn.id}/test`)).statusCode).toBe(403)

    const bad = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/email-connections/${conn.id}`, { replyTo: 'not an email' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().code).toBe('INVALID_REPLY_TO')
    const ok = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/email-connections/${conn.id}`, { displayName: 'Acme Plumbing', replyTo: 'hello@acme.test' })
    expect(ok.statusCode).toBe(200)
    await validateResponse('updateEmailConnection', 200, ok.json())
    expect(ok.json().data).toMatchObject({ displayName: 'Acme Plumbing', replyTo: 'hello@acme.test' })
    expect(await db.actionExecution.count({ where: { workspaceId: ws.id, action: 'emailConnection.update', status: 'succeeded' } })).toBe(1)

    const other = await createWorkspace(app, carolId, { name: 'Other' })
    expect((await call(testUserId, 'GET', `/workspaces/${other.id}/email-connections`)).statusCode).toBe(404)
    expect((await call(testUserId, 'PATCH', `/workspaces/${ws.id}/email-connections/${(await defaultConnection(other.id)).id}`, { replyTo: null })).statusCode).toBe(404)
  })

  it('test sends a short email to the caller from the workspace name, replies to the workspace', async () => {
    const ws = await createWorkspace(app)
    const conn = await defaultConnection(ws.id)
    const res = await call(testUserId, 'POST', `/workspaces/${ws.id}/email-connections/${conn.id}/test`)
    expect(res.statusCode).toBe(200)
    await validateResponse('testEmailConnection', 200, res.json())
    expect(res.json().data).toMatchObject({ ok: true, sentTo: 'alice@test.local', error: null, providerMessageId: expect.stringMatching(/^dev:/) })
    const mail = await db.devOutboxEmail.findFirstOrThrow({ where: { to: 'alice@test.local' } })
    expect(mail).toMatchObject({ from: '"Acme Co" <agents@8080.localhost>', replyTo: 'alice@test.local', html: '' })
    expect((await db.emailConnection.findUniqueOrThrow({ where: { id: conn.id } })).lastTestedAt).not.toBeNull()
  })
})

// ─── Resend platform provider ──────────────────────────────────────────────────

describe('ResendPlatformProvider', () => {
  afterEach(() => vi.unstubAllGlobals())
  const conn = { id: 'c1', workspaceId: 'w1', strategy: 'platform', displayName: 'Acme "Co"', replyTo: 'hello@acme.test' } as any
  const email = { to: 'sarah@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', idempotencyKey: 'agent-target:t1' }
  const respond = (status: number, body: object) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

  it('sends From = workspace name on the platform address, Reply-To = the workspace, with an idempotency key', async () => {
    respond(200, { id: 'msg_1' })
    const result = await new ResendPlatformProvider('re_test').send(conn, email)
    expect(result).toEqual({ ok: true, providerMessageId: 'msg_1' })
    const [url, init] = (globalThis.fetch as any).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_test', 'Idempotency-Key': 'agent-target:t1' })
    expect(JSON.parse(init.body)).toEqual({ from: '"Acme Co" <agents@8080.localhost>', to: ['sarah@example.com'], subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', reply_to: 'hello@acme.test' })
  })

  it('classifies failures: 429/5xx/network transient, 401/403 auth, other 4xx permanent', async () => {
    const p = new ResendPlatformProvider('re_test')
    respond(429, { name: 'rate_limit_exceeded', message: 'slow down' })
    expect(await p.send(conn, email)).toMatchObject({ ok: false, kind: 'transient', code: 'RESEND_RATE_LIMIT_EXCEEDED' })
    respond(503, {})
    expect(await p.send(conn, email)).toMatchObject({ ok: false, kind: 'transient' })
    respond(401, { name: 'invalid_api_key', message: 'bad key' })
    expect(await p.send(conn, email)).toMatchObject({ ok: false, kind: 'auth' })
    respond(422, { name: 'validation_error', message: 'Invalid `to` field' })
    expect(await p.send(conn, email)).toMatchObject({ ok: false, kind: 'permanent', message: 'Invalid `to` field' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    expect(await p.send(conn, email)).toMatchObject({ ok: false, kind: 'transient', code: 'NETWORK' })
  })

  it('without a key it reports the platform as not set up and sends nothing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const p = new ResendPlatformProvider('')
    expect(await p.test(conn)).toMatchObject({ ok: false, code: 'PLATFORM_NOT_CONFIGURED' })
    expect(await p.send(conn, email)).toMatchObject({ ok: false, kind: 'auth', code: 'PLATFORM_NOT_CONFIGURED' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

// ─── platform configuration (production never falls back to the dev outbox) ────

describe('platform email configuration', () => {
  afterEach(() => vi.unstubAllEnvs())
  const conn = { id: 'c1', workspaceId: 'w1', strategy: 'platform', displayName: 'Acme Co', replyTo: 'hello@acme.test' } as any

  it('EMAIL_PLATFORM_FROM may be an address or "Name <address>"; the workspace name is shown', () => {
    expect(parseFrom('Hatsy Shirtsy <notifications@hatsyshirtsy.com>')).toEqual({ address: 'notifications@hatsyshirtsy.com', name: 'Hatsy Shirtsy' })
    expect(parseFrom('"Hatsy, Shirtsy" <n@h.com>')).toEqual({ address: 'n@h.com', name: 'Hatsy, Shirtsy' })
    expect(parseFrom('notifications@hatsyshirtsy.com')).toEqual({ address: 'notifications@hatsyshirtsy.com', name: null })
    expect(parseFrom('Hatsy Shirtsy')).toBeNull()
    vi.stubEnv('EMAIL_PLATFORM_FROM', 'Hatsy Shirtsy <notifications@hatsyshirtsy.com>')
    expect(platformIdentity(conn)).toMatchObject({ from: '"Acme Co" <notifications@hatsyshirtsy.com>', replyTo: 'hello@acme.test' })
    expect(platformIdentity({ ...conn, displayName: ' ' })?.from).toBe('"Hatsy Shirtsy" <notifications@hatsyshirtsy.com>')
  })

  it('transport: production always Resend, tests always the dev outbox, local dev only Resend when asked', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('EMAIL_TRANSPORT', 'resend')
    expect(emailTransport()).toBe('dev')
    vi.stubEnv('NODE_ENV', 'development')
    expect(emailTransport()).toBe('resend')
    vi.stubEnv('EMAIL_TRANSPORT', '')
    vi.stubEnv('RESEND_API_KEY', 're_local')
    expect(emailTransport()).toBe('dev') // a key alone never makes local dev send for real
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EMAIL_TRANSPORT', 'dev')
    expect(emailTransport()).toBe('resend')
    expect(providerFor(conn).name).toBe('resend-platform')
  })

  it('production without configuration says what is missing, never prints the key, and sends nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_PLATFORM_FROM', '')
    expect(describeEmailSetup()).toEqual({ ok: false, line: 'email: Resend NOT CONFIGURED — missing RESEND_API_KEY, EMAIL_PLATFORM_FROM; every platform send will fail' })
    vi.stubEnv('RESEND_API_KEY', 're_secret_value')
    vi.stubEnv('EMAIL_PLATFORM_FROM', 'Hatsy Shirtsy')
    expect(describeEmailSetup().line).toBe('email: Resend NOT CONFIGURED — missing EMAIL_PLATFORM_FROM (not an email address); every platform send will fail')
    vi.stubEnv('EMAIL_PLATFORM_FROM', 'Hatsy Shirtsy <notifications@hatsyshirtsy.com>')
    expect(describeEmailSetup()).toEqual({ ok: true, line: 'email: Resend, from notifications@hatsyshirtsy.com' })
    expect(JSON.stringify(describeEmailSetup())).not.toContain('re_secret_value')

    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn())
    const result = await providerFor(conn).send(conn, { to: 'a@b.com', subject: 's', html: '', text: 't' })
    expect(result).toMatchObject({ ok: false, kind: 'auth', code: 'PLATFORM_NOT_CONFIGURED' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(await db.devOutboxEmail.count()).toBe(0)
    vi.unstubAllGlobals()
  })

  it('the API key never appears in a result, even when Resend rejects it', async () => {
    vi.stubEnv('EMAIL_PLATFORM_FROM', 'notifications@hatsyshirtsy.com')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'validation_error', message: 'API key is invalid' }), { status: 403 })))
    const result = await new ResendPlatformProvider('re_secret_value').send(conn, { to: 'a@b.com', subject: 's', html: '', text: 't' })
    expect(result).toMatchObject({ ok: false, kind: 'auth' })
    expect(JSON.stringify(result)).not.toContain('re_secret_value')
    vi.unstubAllGlobals()
  })
})

// ─── job runner ────────────────────────────────────────────────────────────────

const FIXTURE = 'test_morning_note'
type Mode = { blocked?: boolean; recipients?: (base: any) => EmailRecipient[]; dedupe?: (r: EmailRecipient) => string | null }
let mode: Mode = {}

describe('job runner', () => {
  let unregister: () => void
  beforeAll(() => {
    unregister = registerAgentType({
      key: FIXTURE,
      family: 'team',
      name: 'Morning note',
      description: 'test fixture',
      enabled: false,
      destinations: ['email'],
      defaults: () => ({ name: 'Morning note', templateKey: 'basic', themeKey: 'company', recipientConfig: {}, deliveryConfig: {}, ruleConfig: {} }),
      validate: () => [],
      schedule: (agent, after, tz) => nextOccurrence((agent.ruleConfig as any).schedule, after, tz),
      prepare: async ({ workspace }) => {
        if (mode.blocked) return { ok: false, code: 'NO_READY_MESSAGE', summary: 'No message is ready to send.' }
        const base = await baseValues(workspace)
        const list = mode.recipients ? mode.recipients(base) : await workspaceMembers(workspace, base)
        return {
          ok: true,
          email: {
            subject: 'Good morning, {{member.firstName|team}}',
            content: { version: 1, blocks: [{ type: 'heading', text: 'Today at {{company.name}}' }, { type: 'text', text: 'Hello <team>' }] },
            template: 'team_brief',
            theme: 'company',
            footer: ['Sent by {{company.name}} with 8080'],
            recipients: list.map((r) => ({ ...r, dedupeKey: mode.dedupe ? mode.dedupe(r) : null })),
          },
        }
      },
    })
  })
  afterAll(() => unregister())
  afterEach(() => {
    mode = {}
  })

  const T0 = new Date('2026-10-07T12:00:00Z') // 08:00 in New York
  const NINE = new Date('2026-10-07T13:00:00Z') // 09:00 in New York

  async function setup(status: 'active' | 'paused' = 'active') {
    await seedPeople()
    const ws = await createWorkspace(app, testUserId, { name: 'Acme Co', timezone: 'America/New_York' })
    await join(app, ws.id, carolId, 'carol@test.local')
    const agent = await db.agent.create({
      data: {
        workspaceId: ws.id,
        typeKey: FIXTURE,
        family: 'team',
        name: 'Morning note',
        status,
        recipientConfig: { source: 'WORKSPACE_MEMBERS' },
        deliveryConfig: { destinations: ['email'] },
        ruleConfig: { schedule: { repeat: 'daily', time: '09:00' } },
        templateKey: 'team_brief',
        themeKey: 'company',
        createdByMemberId: await memberId(ws.id, testUserId),
      },
    })
    return { ws, agent }
  }
  const events = (agentId: string) => db.agentEvent.findMany({ where: { agentId }, orderBy: { scheduledFor: 'asc' } })
  const recipient = (address: string | null, label = address ?? 'Nobody'): EmailRecipient => ({ address, label, values: { 'member.firstName': label } })

  it('keeps one upcoming event, sends on time to every member, then schedules the next', async () => {
    const { agent } = await setup()
    await scheduleNext(agent.id, T0)
    await scheduleNext(agent.id, T0) // idempotent
    expect((await events(agent.id)).map((e) => [e.status, e.occurrenceKey, e.scheduledFor.toISOString()])).toEqual([['scheduled', '2026-10-07T09:00', NINE.toISOString()]])

    expect(await tick(new Date(NINE.getTime() - 1000))).toEqual([])
    const [first] = await events(agent.id)
    expect(await tick(NINE)).toEqual([first!.id])

    const done = await db.agentEvent.findUniqueOrThrow({ where: { id: first!.id }, include: { deliveries: { include: { targets: true } } } })
    expect(done).toMatchObject({ status: 'completed', targetCount: 2, successCount: 2, failureCount: 0, skippedCount: 0, failureSummary: null })
    expect(done.deliveries[0]).toMatchObject({ destination: 'email', status: 'completed', successCount: 2 })
    expect(done.deliveries[0]!.sender).toMatchObject({ strategy: 'platform', displayName: 'Acme Co' })

    const mail = await db.devOutboxEmail.findMany({ orderBy: { to: 'asc' } })
    expect(mail.map((m) => [m.to, m.subject])).toEqual([
      ['alice@test.local', 'Good morning, Alice'],
      ['carol@test.local', 'Good morning, Carol'],
    ])
    expect(mail[0]!.html).toContain('Hello &lt;team&gt;')
    expect(mail[0]!.html).toContain('Today at Acme Co')
    expect(mail[0]!.text).toContain('Sent by Acme Co with 8080')

    // Exactly one upcoming event again: tomorrow at 09:00.
    const after = await events(agent.id)
    expect(after.map((e) => [e.status, e.occurrenceKey])).toEqual([
      ['completed', '2026-10-07T09:00'],
      ['scheduled', '2026-10-08T09:00'],
    ])
    expect(await tick(NINE)).toEqual([]) // nothing double-sent
    expect(await db.devOutboxEmail.count()).toBe(2)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('a missing address is a visible failure; duplicates are skipped, not sent twice', async () => {
    const { agent } = await setup()
    mode = { recipients: () => [recipient('sam@example.com', 'Sam'), recipient('sam@example.com', 'Sam again'), recipient(null, 'Pat')], dedupe: (r) => `once:${r.address}` }
    await scheduleNext(agent.id, T0)
    await tick(NINE)
    const [e1] = await events(agent.id)
    expect(e1).toMatchObject({ status: 'completed', targetCount: 3, successCount: 1, failureCount: 1, skippedCount: 1, failureCode: 'MISSING_EMAIL', failureSummary: '1 failed — Pat has no valid email address.' })
    expect(await db.activityEvent.count({ where: { sourceId: e1!.id, type: 'agent.failed' } })).toBe(1)

    // The next day: Sam was already sent this "once" message → skipped; with nothing
    // sent and Pat still failing, the event as a whole failed.
    await tick(new Date('2026-10-08T13:00:00Z'))
    const e2 = (await events(agent.id))[1]!
    expect(e2).toMatchObject({ status: 'failed', successCount: 0, skippedCount: 2, failureCount: 1 })
    expect(await db.devOutboxEmail.count({ where: { to: 'sam@example.com' } })).toBe(1)
  })

  it('transient errors retry with a delay, every attempt recorded, up to the limit', async () => {
    const { agent } = await setup()
    mode = { recipients: () => [recipient('ok@example.com'), recipient('fail.transient@example.com', 'Flaky')] }
    await scheduleNext(agent.id, T0)
    await tick(NINE)
    let [ev] = await events(agent.id)
    expect(ev).toMatchObject({ status: 'running', leaseUntil: new Date(NINE.getTime() + RETRY_DELAY_MS) })
    expect(await tick(new Date(NINE.getTime() + RETRY_DELAY_MS - 1))).toEqual([]) // not yet

    let t = NINE.getTime()
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      t += RETRY_DELAY_MS
      expect(await tick(new Date(t))).toEqual([ev!.id])
    }
    ev = (await events(agent.id))[0]
    expect(ev).toMatchObject({ status: 'completed', successCount: 1, failureCount: 1, failureCode: 'SIMULATED_TRANSIENT' })
    const flaky = await db.agentEventTarget.findFirstOrThrow({ where: { address: 'fail.transient@example.com' }, include: { sendAttempts: { orderBy: { number: 'asc' } } } })
    expect(flaky).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, dedupeSlot: null })
    expect(flaky.sendAttempts.map((a) => a.outcome)).toEqual(['transient', 'transient', 'transient'])
    expect(await db.agentSendAttempt.count({ where: { target: { address: 'ok@example.com' } } })).toBe(1)
  })

  it('permanent errors fail at once; an auth error stops the rest of the delivery', async () => {
    const { agent } = await setup()
    mode = { recipients: () => [recipient('fail.permanent@example.com'), recipient('fail.auth@example.com'), recipient('later@example.com')] }
    await scheduleNext(agent.id, T0)
    await tick(NINE)
    const [ev] = await events(agent.id)
    expect(ev).toMatchObject({ status: 'failed', successCount: 0, failureCount: 3 })
    const targets = await db.agentEventTarget.findMany({ orderBy: { createdAt: 'asc' }, include: { sendAttempts: true } })
    expect(targets.map((t) => [t.address, t.status, t.failureCode, t.sendAttempts.length])).toEqual([
      ['fail.permanent@example.com', 'failed', 'SIMULATED_PERMANENT', 1],
      ['fail.auth@example.com', 'failed', 'SIMULATED_AUTH', 1],
      ['later@example.com', 'failed', 'SIMULATED_AUTH', 0],
    ])
    expect(await db.devOutboxEmail.count()).toBe(0)
  })

  it('nothing to send fails the event visibly and the schedule continues', async () => {
    const { agent } = await setup()
    mode = { blocked: true }
    await scheduleNext(agent.id, T0)
    await tick(NINE)
    const [ev, upcoming] = await events(agent.id)
    expect(ev).toMatchObject({ status: 'failed', failureCode: 'NO_READY_MESSAGE', failureSummary: 'No message is ready to send.' })
    expect(upcoming).toMatchObject({ status: 'scheduled', occurrenceKey: '2026-10-08T09:00' })
    expect(await db.activityEvent.findFirst({ where: { sourceId: ev!.id } })).toMatchObject({ type: 'agent.failed', title: 'Morning note needs attention' })

    mode = { recipients: () => [] }
    await tick(new Date('2026-10-08T13:00:00Z'))
    expect((await events(agent.id))[1]).toMatchObject({ status: 'failed', failureCode: 'NO_RECIPIENTS' })
  })

  it('a paused agent cancels its due event and schedules nothing', async () => {
    const { agent } = await setup()
    await scheduleNext(agent.id, T0)
    await db.agent.update({ where: { id: agent.id }, data: { status: 'paused' } })
    await tick(NINE)
    expect((await events(agent.id)).map((e) => e.status)).toEqual(['canceled'])
    expect(await scheduleNext(agent.id, NINE)).toBeNull()
    expect(await db.devOutboxEmail.count()).toBe(0)
  })

  it('an edited schedule replaces the upcoming event; a stale lease is reclaimed', async () => {
    const { agent } = await setup()
    await scheduleNext(agent.id, T0)
    await db.agent.update({ where: { id: agent.id }, data: { ruleConfig: { schedule: { repeat: 'daily', time: '10:30' } } } })
    await scheduleNext(agent.id, T0)
    const [ev] = await events(agent.id)
    expect((await events(agent.id)).map((e) => e.occurrenceKey)).toEqual(['2026-10-07T10:30'])

    // A runner that died mid-event: running, lease expired → picked up again.
    await db.agentEvent.update({ where: { id: ev!.id }, data: { status: 'running', leaseUntil: new Date('2026-10-07T14:30:00Z') } })
    expect(await tick(new Date('2026-10-07T14:29:00Z'))).toEqual([])
    expect(await tick(new Date('2026-10-07T14:31:00Z'))).toEqual([ev!.id])
    expect((await db.agentEvent.findUniqueOrThrow({ where: { id: ev!.id } })).status).toBe('completed')
  })
})
