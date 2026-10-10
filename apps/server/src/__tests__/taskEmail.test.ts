// Task notices by email: in-app always; a member's choice (off / direct / all) adds an
// email copy, sent after the commit through the workspace sender, retried by the sweep.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { setEmailProvider, type EmailProvider } from '../services/agents/email'
import { drainTaskEmails, sweepTaskEmails } from '../services/taskEmail'
import { WorkspaceHost } from '../services/WorkspaceHost'

const app = buildTestApp()
const call = caller(app)

afterEach(() => {
  setEmailProvider(null)
  vi.unstubAllEnvs()
})

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  return { ws, carol, base: `/workspaces/${ws.id}/tasks`, settings: `/workspaces/${ws.id}/task-notifications` }
}

const create = async (base: string, body: object) => {
  const res = await call(testUserId, 'POST', base, body)
  if (res.statusCode !== 201) throw new Error(`create task: ${res.statusCode} ${res.body}`)
  return res.json().data
}

const carolMail = async () => {
  await drainTaskEmails()
  return db.devOutboxEmail.findMany({ where: { to: 'carol@test.local' }, orderBy: { createdAt: 'asc' } })
}

describe('task notice email', () => {
  it('emails mentions and assignments by default; every notice on "all"; nothing on "off"', async () => {
    const { ws, base, carol, settings } = await setup()
    const got = await call(carolId, 'GET', settings)
    await validateResponse('getTaskNotificationSettings', 200, got.json())
    expect(got.json().data).toEqual({ email: 'direct' })

    // Assigned: emailed, with the notice's words.
    const task = await create(base, { title: 'Fix the login', assigneeMemberId: carol })
    let mail = await carolMail()
    expect(mail).toHaveLength(1)
    expect(mail[0]!.subject).toBe(`Alice assigned you ${task.taskKey}`)
    expect(mail[0]!.text).toContain('Fix the login')
    expect(mail[0]!.from).toContain('<agents@8080.localhost>')
    const row = await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: task.id } })
    expect(row).toMatchObject({ emailStatus: 'sent', emailAttempts: 1 })
    expect(row.emailedAt).not.toBeNull()

    // With an app address, the button opens the task on the workspace channel's page.
    vi.stubEnv('APP_URL', 'https://app.test.local')
    const unlinked = await create(base, { title: 'No channel yet', assigneeMemberId: carol })
    expect((await carolMail()).at(-1)!.html).toContain('href="https://app.test.local/"')
    await db.devOutboxEmail.deleteMany({ where: { subject: { contains: unlinked.taskKey } } })
    const channel = await new WorkspaceHost().ensureChannel(ws.id)
    await db.roomMember.create({ data: { roomId: channel.roomId, userId: carolId } })
    const linked = await create(base, { title: 'With a link', assigneeMemberId: carol })
    expect((await carolMail()).at(-1)!.html).toContain(`https://app.test.local/room/${channel.roomId}?desk=calendar&amp;ticket=${linked.taskKey}`)
    await db.devOutboxEmail.deleteMany({ where: { subject: { contains: linked.taskKey } } })

    // A handoff isn't direct: in-app only.
    await call(testUserId, 'POST', `${base}/${task.id}/move`, { status: 'done' })
    expect(await carolMail()).toHaveLength(1)
    expect(await db.inboxItem.count({ where: { memberId: carol, sourceId: task.id } })).toBe(2)

    // Mentioned: emailed.
    await call(testUserId, 'POST', `${base}/${task.id}/comments`, { text: '@Carol can you check this?' })
    mail = await carolMail()
    expect(mail.map((m) => m.subject)).toEqual([`Alice assigned you ${task.taskKey}`, `Alice mentioned you on ${task.taskKey}`])

    // Everything.
    const put = await call(carolId, 'PUT', settings, { email: 'all' })
    await validateResponse('updateTaskNotificationSettings', 200, put.json())
    await call(testUserId, 'POST', `${base}/${task.id}/move`, { status: 'in_review' })
    expect((await carolMail()).at(-1)!.subject).toBe(`Alice moved ${task.taskKey} to In review`)

    // Off: still in For you, no email; the row never asks for one.
    await call(carolId, 'PUT', settings, { email: 'off' })
    const quiet = await create(base, { title: 'Quiet one', assigneeMemberId: carol })
    expect(await carolMail()).toHaveLength(3)
    expect(await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: quiet.id } })).toMatchObject({ emailStatus: null })

    // The actor never hears about their own change; settings are per member and validated.
    expect(await db.devOutboxEmail.count({ where: { to: { not: 'carol@test.local' } } })).toBe(0)
    expect((await call(testUserId, 'GET', settings)).json().data).toEqual({ email: 'direct' })
    expect((await call(carolId, 'PUT', settings, { email: 'sometimes' })).statusCode).toBe(400)
  })

  it('retries transient failures 2 minutes apart, at most 3 times; a notice read meanwhile is not emailed', async () => {
    const { base, carol } = await setup()
    const sent: string[] = []
    let fail: 'transient' | 'permanent' | null = 'transient'
    const flaky: EmailProvider = {
      name: 'flaky',
      test: async () => ({ ok: true }),
      send: async (_c, email) => {
        if (fail) return { ok: false, kind: fail, code: fail === 'transient' ? 'TIMEOUT' : 'REJECTED', message: 'no' }
        sent.push(email.idempotencyKey!)
        return { ok: true, providerMessageId: 'm1' }
      },
    }
    setEmailProvider(flaky)

    const task = await create(base, { title: 'Retry me', assigneeMemberId: carol })
    await drainTaskEmails()
    const row = await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: task.id } })
    expect(row).toMatchObject({ emailStatus: 'pending', emailAttempts: 1, emailError: 'TIMEOUT' })

    // Not due yet; then due 2 minutes later, and it goes through once the provider recovers.
    expect(await sweepTaskEmails(new Date())).toEqual([])
    const later = new Date(row.emailNextAt!.getTime() + 1)
    fail = null
    expect(await sweepTaskEmails(later)).toEqual([row.id])
    expect(await db.inboxItem.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ emailStatus: 'sent', emailAttempts: 2 })
    expect(sent).toEqual([`task-notice:${row.id}`])

    // Gives up after 3 attempts.
    fail = 'transient'
    const second = await create(base, { title: 'Never arrives', assigneeMemberId: carol })
    await drainTaskEmails()
    const id = (await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: second.id } })).id
    let at = new Date()
    for (let i = 0; i < 3; i++) {
      at = new Date(at.getTime() + 3 * 60_000)
      await sweepTaskEmails(at)
    }
    expect(await db.inboxItem.findUniqueOrThrow({ where: { id } })).toMatchObject({ emailStatus: 'failed', emailAttempts: 3, emailError: 'TIMEOUT' })

    // A permanent failure stops at once.
    fail = 'permanent'
    const third = await create(base, { title: 'Rejected', assigneeMemberId: carol })
    await drainTaskEmails()
    expect(await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: third.id } })).toMatchObject({ emailStatus: 'failed', emailAttempts: 1, emailError: 'REJECTED' })

    // Read in the app before the retry: skipped.
    fail = 'transient'
    const fourth = await create(base, { title: 'Seen already', assigneeMemberId: carol })
    await drainTaskEmails()
    const seen = await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: fourth.id } })
    await db.inboxItem.update({ where: { id: seen.id }, data: { unread: false } })
    fail = null
    await sweepTaskEmails(new Date(seen.emailNextAt!.getTime() + 1))
    expect(await db.inboxItem.findUniqueOrThrow({ where: { id: seen.id } })).toMatchObject({ emailStatus: 'skipped' })
    expect(sent).toHaveLength(1)
  })
})
