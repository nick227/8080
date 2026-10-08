// "Use my own email" over SMTP (docs/agents/07 S5, pulled forward): a real SMTP
// conversation with a local server (AUTH + STARTTLS). The password is stored encrypted
// and never returned; agents can pick the sender; failures land where S0 put them.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { SMTPServer } from 'smtp-server'
import nodemailer from 'nodemailer'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId, seedBotUser } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { tick } from '../services/agents/runner'
import { classifySmtpError, setSmtpTransportFactory, smtpHostProblem } from '../services/agents/email/smtp'

const app = buildTestApp()
const call = caller(app)

type Received = { from: string; to: string[]; raw: string }
let inbox: Received[] = []
let server: SMTPServer
let port = 0
const PASSWORD = 'app-password-123'

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: false,
    onAuth: (auth, _session, cb) => (auth.username === 'shop@acme.test' && auth.password === PASSWORD ? cb(null, { user: auth.username }) : cb(new Error('Invalid login'))),
    onData: (stream, session, cb) => {
      let raw = ''
      stream.on('data', (chunk) => (raw += chunk.toString()))
      stream.on('end', () => {
        inbox.push({ from: session.envelope.mailFrom ? (session.envelope.mailFrom as { address: string }).address : '', to: session.envelope.rcptTo.map((r) => r.address), raw })
        cb()
      })
    },
    logger: false,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.server.address() as { port: number }).port
  // Same options as production, pointed at the local server (self-signed STARTTLS).
  setSmtpTransportFactory((options) => nodemailer.createTransport({ ...options, host: '127.0.0.1', port, tls: { rejectUnauthorized: false } }))
})
afterAll(async () => {
  setSmtpTransportFactory(null)
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
let host: ReturnType<typeof startWorkspaceHost>
beforeAll(() => {
  host = startWorkspaceHost()
})
afterAll(() => host.stop())
beforeEach(async () => {
  inbox = []
  await seedBotUser({ handle: 'chatbot', name: 'chatbot' })
  await seedPeople()
})
afterEach(() => host.idle())

const smtp = (password = PASSWORD) => ({ host: 'smtp.acme.test', port: 587, security: 'starttls', username: 'shop@acme.test', password })
const base = (id: string) => `/workspaces/${id}`

async function addSmtp(wsId: string, extra: object = {}) {
  const res = await call(testUserId, 'POST', `${base(wsId)}/email-connections`, { strategy: 'smtp', displayName: 'Acme Shop', fromAddress: 'shop@acme.test', replyTo: 'hello@acme.test', smtp: smtp(), ...extra })
  expect(res.statusCode).toBe(201)
  return res.json().data
}

describe('own SMTP sender', () => {
  it('is added by admins; the password is encrypted and never returned or audited', async () => {
    const ws = await createWorkspace(app)
    await join(app, ws.id, carolId, 'carol@test.local')
    expect((await call(carolId, 'POST', `${base(ws.id)}/email-connections`, { strategy: 'smtp', displayName: 'x', fromAddress: 'a@b.co', smtp: smtp() })).statusCode).toBe(403)

    const res = await call(testUserId, 'POST', `${base(ws.id)}/email-connections`, { strategy: 'smtp', displayName: 'Acme Shop', fromAddress: 'shop@acme.test', replyTo: 'hello@acme.test', smtp: smtp() })
    expect(res.statusCode).toBe(201)
    await validateResponse('createEmailConnection', 201, res.json())
    expect(res.json().data).toMatchObject({
      mode: 'own',
      strategy: 'smtp',
      label: 'Acme Shop · shop@acme.test',
      isDefault: false,
      smtp: { host: 'smtp.acme.test', port: 587, security: 'starttls', username: 'shop@acme.test' },
    })
    const list = await call(carolId, 'GET', `${base(ws.id)}/email-connections`)
    await validateResponse('listEmailConnections', 200, list.json())
    const everything = JSON.stringify([res.json(), list.json(), await db.actionExecution.findMany({ where: { workspaceId: ws.id } }), await db.emailConnection.findMany()])
    expect(everything).not.toContain(PASSWORD)
    expect((await db.emailConnection.findUniqueOrThrow({ where: { id: res.json().data.id } })).secret).toMatch(/^v1\./)
  })

  it('refuses non-mail ports, bad hosts and addresses', async () => {
    const ws = await createWorkspace(app)
    const post = (body: object) => call(testUserId, 'POST', `${base(ws.id)}/email-connections`, { strategy: 'smtp', displayName: 'x', fromAddress: 'shop@acme.test', smtp: smtp(), ...body })
    expect((await post({ smtp: { ...smtp(), port: 3306 } })).statusCode).toBe(400) // spec enum
    expect((await post({ smtp: { ...smtp(), host: 'smtp acme' } })).json()).toMatchObject({ code: 'INVALID_SMTP' })
    expect((await post({ fromAddress: 'nope' })).json()).toMatchObject({ code: 'INVALID_FROM' })
    expect(await smtpHostProblem('smtp.gmail.com', 3306)).toMatch(/mail port/)
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(await smtpHostProblem('localhost', 587)).toBe('That mail server is not reachable from here')
      expect(await smtpHostProblem('10.0.0.5', 587)).toBe('That mail server is not reachable from here')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('the test endpoint really sends over SMTP and returns the message id', async () => {
    const ws = await createWorkspace(app)
    const conn = await addSmtp(ws.id)
    const res = await call(testUserId, 'POST', `${base(ws.id)}/email-connections/${conn.id}/test`)
    expect(res.statusCode).toBe(200)
    await validateResponse('testEmailConnection', 200, res.json())
    expect(res.json().data).toMatchObject({ ok: true, sentTo: 'alice@test.local', error: null })
    expect(res.json().data.providerMessageId).toMatch(/^<.+>$/)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ from: 'shop@acme.test', to: ['alice@test.local'] })
    expect(inbox[0]!.raw).toContain('From: Acme Shop <shop@acme.test>')
    expect(inbox[0]!.raw).toContain('Reply-To: hello@acme.test')
    expect(await db.devOutboxEmail.count()).toBe(0) // own senders never go to the outbox
  })

  it('a wrong password fails as auth and marks the sender; new credentials clear it', async () => {
    const ws = await createWorkspace(app)
    const conn = await addSmtp(ws.id, { smtp: smtp('wrong') })
    const res = await call(testUserId, 'POST', `${base(ws.id)}/email-connections/${conn.id}/test`)
    expect(res.json().data).toMatchObject({ ok: false, error: { code: 'SMTP_AUTH' }, connection: { status: 'needs_attention' } })
    const fixed = await call(testUserId, 'PATCH', `${base(ws.id)}/email-connections/${conn.id}`, { smtp: { password: PASSWORD } })
    expect(fixed.json().data).toMatchObject({ status: 'active', lastError: null, smtp: { host: 'smtp.acme.test', username: 'shop@acme.test' } })
    expect((await call(testUserId, 'POST', `${base(ws.id)}/email-connections/${conn.id}/test`)).json().data.ok).toBe(true)
    expect((await call(testUserId, 'PATCH', `${base(ws.id)}/email-connections/${(await db.emailConnection.findFirstOrThrow({ where: { workspaceId: ws.id, strategy: 'platform' } })).id}`, { smtp: { password: 'x' } })).json().code).toBe('PLATFORM_FIXED')
  })

  it('default moves; the default and the platform cannot be removed; removing falls agents back', async () => {
    const ws = await createWorkspace(app)
    const conn = await addSmtp(ws.id)
    const made = await call(testUserId, 'PATCH', `${base(ws.id)}/email-connections/${conn.id}`, { makeDefault: true })
    expect(made.json().data.isDefault).toBe(true)
    const all = (await call(testUserId, 'GET', `${base(ws.id)}/email-connections`)).json().data
    expect(all.filter((c: any) => c.isDefault).map((c: any) => c.id)).toEqual([conn.id])
    const platform = all.find((c: any) => c.mode === 'platform')
    expect((await call(testUserId, 'DELETE', `${base(ws.id)}/email-connections/${conn.id}`)).json().code).toBe('DEFAULT_SENDER')
    expect((await call(testUserId, 'DELETE', `${base(ws.id)}/email-connections/${platform.id}`)).json().code).toBe('PLATFORM_FIXED')

    await call(testUserId, 'PATCH', `${base(ws.id)}/email-connections/${platform.id}`, { makeDefault: true })
    const agent = (await call(testUserId, 'POST', `${base(ws.id)}/agents`, { typeKey: 'daily_team_brief' })).json().data
    const chosen = await call(testUserId, 'PATCH', `${base(ws.id)}/agents/${agent.id}`, { emailConnectionId: conn.id })
    expect(chosen.json().data.sender).toMatchObject({ id: conn.id, mode: 'own' })
    const del = await call(testUserId, 'DELETE', `${base(ws.id)}/email-connections/${conn.id}`)
    await validateResponse('deleteEmailConnection', 200, del.json())
    expect(del.json().data).toEqual({ removed: true, agentsMovedToDefault: 1 })
    expect((await call(testUserId, 'GET', `${base(ws.id)}/agents/${agent.id}`)).json().data.sender).toMatchObject({ mode: 'platform' })

    const other = await createWorkspace(app, carolId, { name: 'Other' })
    const foreign = await db.emailConnection.findFirstOrThrow({ where: { workspaceId: other.id } })
    expect((await call(testUserId, 'PATCH', `${base(ws.id)}/agents/${agent.id}`, { emailConnectionId: foreign.id })).json().code).toBe('INVALID_SENDER')
  })

  it('a Team agent on the SMTP sender delivers its event over SMTP', async () => {
    const ws = await createWorkspace(app, testUserId, { name: 'Acme Co', timezone: 'America/New_York' })
    await join(app, ws.id, carolId, 'carol@test.local')
    const conn = await addSmtp(ws.id)
    const agent = (await call(testUserId, 'POST', `${base(ws.id)}/agents`, { typeKey: 'daily_team_brief' })).json().data
    await call(testUserId, 'PATCH', `${base(ws.id)}/agents/${agent.id}`, { emailConnectionId: conn.id, destinations: ['email'] })
    await call(testUserId, 'POST', `${base(ws.id)}/agents/${agent.id}/publish`)
    const ev = await db.agentEvent.findFirstOrThrow({ where: { agentId: agent.id, status: 'scheduled' } })
    const at = new Date()
    await db.agentEvent.update({ where: { id: ev.id }, data: { scheduledFor: at, occurrenceKey: `test:${at.toISOString()}` } })
    await tick(new Date(at.getTime() + 1))
    expect(await db.agentEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ status: 'completed', successCount: 2 })
    expect(inbox.map((m) => m.to[0]).sort()).toEqual(['alice@test.local', 'carol@test.local'])
    const target = await db.agentEventTarget.findFirstOrThrow({ where: { address: 'alice@test.local' } })
    expect(inbox.find((m) => m.to[0] === 'alice@test.local')!.raw).toContain(`Message-ID: <agent-target:${target.id}@acme.test>`)
    expect(target.providerMessageId).toBe(`<agent-target:${target.id}@acme.test>`)
    expect((await db.agentEventDelivery.findFirstOrThrow({ where: { eventId: ev.id } })).sender).toMatchObject({ strategy: 'smtp', displayName: 'Acme Shop' })
  })

  it('POC proof: delivers through platform sender, then switches the same Agent to SMTP, capturing provider message IDs with identical event history structure', async () => {
    const ws = await createWorkspace(app, testUserId, { name: 'Acme Co', timezone: 'America/New_York' })
    await join(app, ws.id, carolId, 'carol@test.local')
    const platformConn = await db.emailConnection.findFirstOrThrow({ where: { workspaceId: ws.id, strategy: 'platform' } })
    const smtpConn = await addSmtp(ws.id)

    // 1. Create Agent using default platform sender (Send with 8080)
    const agent = (await call(testUserId, 'POST', `${base(ws.id)}/agents`, { typeKey: 'daily_team_brief' })).json().data
    await call(testUserId, 'PATCH', `${base(ws.id)}/agents/${agent.id}`, { emailConnectionId: platformConn.id, destinations: ['email'] })
    await call(testUserId, 'POST', `${base(ws.id)}/agents/${agent.id}/publish`)

    // Deliver Event 1 via Platform Sender
    const ev1 = await db.agentEvent.findFirstOrThrow({ where: { agentId: agent.id, status: 'scheduled' } })
    const at1 = new Date()
    await db.agentEvent.update({ where: { id: ev1.id }, data: { scheduledFor: at1, occurrenceKey: `test:1:${at1.toISOString()}` } })
    await tick(new Date(at1.getTime() + 1))

    const completedEv1 = await db.agentEvent.findUniqueOrThrow({ where: { id: ev1.id } })
    expect(completedEv1).toMatchObject({ status: 'completed', successCount: 2 })
    const del1 = await db.agentEventDelivery.findFirstOrThrow({ where: { eventId: ev1.id } })
    expect(del1.sender).toMatchObject({ strategy: 'platform' })
    const targets1 = await db.agentEventTarget.findMany({ where: { deliveryId: del1.id } })
    expect(targets1).toHaveLength(2)
    for (const t of targets1) {
      expect(t.status).toBe('sent')
      expect(t.providerMessageId).toBeTruthy()
    }

    // 2. Switch the SAME Agent to the custom SMTP Sender
    await call(testUserId, 'PATCH', `${base(ws.id)}/agents/${agent.id}`, { emailConnectionId: smtpConn.id })
    const updatedAgent = (await call(testUserId, 'GET', `${base(ws.id)}/agents/${agent.id}`)).json().data
    expect(updatedAgent.sender).toMatchObject({ id: smtpConn.id, mode: 'own', strategy: 'smtp' })

    // Schedule and deliver Event 2 via SMTP Sender (ev2 was scheduled by scheduleNext when ev1 completed)
    const ev2 = await db.agentEvent.findFirstOrThrow({ where: { agentId: agent.id, status: 'scheduled' } })
    const at2 = new Date(at1.getTime() + 86400000)
    await db.agentEvent.update({ where: { id: ev2.id }, data: { scheduledFor: at2, occurrenceKey: `test:2:${at2.toISOString()}` } })
    await tick(new Date(at2.getTime() + 1))

    const completedEv2 = await db.agentEvent.findUniqueOrThrow({ where: { id: ev2.id } })
    expect(completedEv2).toMatchObject({ status: 'completed', successCount: 2 })
    const del2 = await db.agentEventDelivery.findFirstOrThrow({ where: { eventId: ev2.id } })
    expect(del2.sender).toMatchObject({ strategy: 'smtp', displayName: 'Acme Shop' })
    const targets2 = await db.agentEventTarget.findMany({ where: { deliveryId: del2.id } })
    expect(targets2).toHaveLength(2)
    for (const t of targets2) {
      expect(t.status).toBe('sent')
      expect(t.providerMessageId).toMatch(/^<.+>$/)
    }

    // 3. Compare structure: both events produce identical history semantics
    expect(completedEv1.status).toEqual(completedEv2.status)
    expect(targets1.map((t) => t.address).sort()).toEqual(targets2.map((t) => t.address).sort())
    expect(inbox.map((m) => m.to[0]).sort()).toEqual(['alice@test.local', 'carol@test.local'])
  })
})

describe('SMTP error classes', () => {
  it('auth, transient and permanent', () => {
    expect(classifySmtpError({ code: 'EAUTH', responseCode: 535, message: 'bad' })).toMatchObject({ kind: 'auth', code: 'SMTP_AUTH' })
    expect(classifySmtpError({ code: 'EENVELOPE', responseCode: 450, message: 'try later' })).toMatchObject({ kind: 'transient', code: 'SMTP_450' })
    expect(classifySmtpError({ code: 'EENVELOPE', responseCode: 550, message: 'no such user' })).toMatchObject({ kind: 'permanent', code: 'SMTP_550' })
    expect(classifySmtpError({ code: 'ETIMEDOUT', message: 'timeout' })).toMatchObject({ kind: 'transient', code: 'SMTP_ETIMEDOUT' })
    expect(classifySmtpError({ code: 'ETLS', message: 'tls' })).toMatchObject({ kind: 'auth', code: 'SMTP_TLS' })
  })
})
