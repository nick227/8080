// The email channel for task notices. A notice is always an inbox row (in-app
// first); a member who wants email gets a copy of it, marked `pending` on the row
// in the same transaction. After the commit it is sent at once; a sweep retries
// rows a send didn't finish (transient failures, a crash mid-send), at most 3 times,
// 2 minutes apart, through the workspace's default sender. A notice already read
// in the app by the time a retry comes round isn't emailed.
import { db, type Prisma } from '@project/db'
import type { EmailBlock } from '@project/shared'
import { defaultConnection } from './agents/connections'
import { isEmailAddress, providerFor } from './agents/email'
import { baseValues } from './agents/audiences'
import { renderEmail } from './agents/presentation'
import { badRequest } from '../lib/errors'
import { runAction } from './actions'
import { authorize } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

type Tx = Prisma.TransactionClient

export const TASK_EMAIL_CHOICES = ['off', 'direct', 'all'] as const
export type TaskEmailChoice = (typeof TASK_EMAIL_CHOICES)[number]

const MAX_ATTEMPTS = 3
const RETRY_MS = 2 * 60_000
/** Older than this and still unsent: the moment has passed. */
const EXPIRE_MS = 24 * 60 * 60_000

/** The caller's own choice (any member may read and set theirs). */
export async function taskEmailSettings(userId: string, workspaceId: string) {
  const actor = await authorize(userId, workspaceId, 'task.read')
  return { email: actor.member.taskEmail as TaskEmailChoice }
}

export async function setTaskEmailSettings(ctx: WorkspaceCtx, workspaceId: string, input: { email: string }) {
  const actor = await authorize(ctx.user.id, workspaceId, 'task.read')
  if (!(TASK_EMAIL_CHOICES as readonly string[]).includes(input.email)) throw badRequest('Choose off, direct or all', 'INVALID_CHOICE')
  return runAction(
    { action: 'task.notifications.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'workspaceMember', id: actor.member.id } },
    async (tx) => {
      await tx.workspaceMember.update({ where: { id: actor.member.id }, data: { taskEmail: input.email } })
      return { value: { email: input.email as TaskEmailChoice }, activities: [] }
    },
  )
}

/** Whether a member's choice wants an email for a notice (direct = mentioned or assigned). */
export const wantsEmail = (choice: string, direct: boolean) => choice === 'all' || (choice === 'direct' && direct)

/** Marks these new inbox rows for an email copy (inside the notice's transaction). */
export async function queueTaskEmails(tx: Tx, rowIds: string[]) {
  if (rowIds.length) await tx.inboxItem.updateMany({ where: { id: { in: rowIds }, emailStatus: null }, data: { emailStatus: 'pending' } })
}

function appUrl() {
  const url = (process.env.APP_URL ?? process.env.CORS_ORIGIN ?? '').split(',')[0]?.trim()
  return url && /^https?:\/\//.test(url) ? url.replace(/\/$/, '') : null
}

const finish = (id: string, data: Prisma.InboxItemUpdateManyMutationInput) => db.inboxItem.updateMany({ where: { id }, data })

/** One attempt for one row; claims it first so two senders never both send. */
async function sendOne(id: string, now: Date) {
  const row = await db.inboxItem.findUnique({
    where: { id },
    include: { member: { include: { user: { select: { email: true } } } }, workspace: true },
  })
  if (!row || row.emailStatus !== 'pending') return
  if (row.emailNextAt && row.emailNextAt > now) return
  if (now.getTime() - row.createdAt.getTime() > EXPIRE_MS) return void (await finish(id, { emailStatus: 'failed', emailError: 'EXPIRED', emailNextAt: null }))
  // Read or archived in the app already, left, or turned email off since it was queued.
  if (!row.unread || row.archivedAt || row.member.status !== 'active' || row.member.taskEmail === 'off') {
    return void (await finish(id, { emailStatus: 'skipped', emailNextAt: null }))
  }
  const claimed = await db.inboxItem.updateMany({
    where: { id, emailStatus: 'pending', emailAttempts: row.emailAttempts },
    data: { emailAttempts: { increment: 1 }, emailNextAt: new Date(now.getTime() + RETRY_MS) },
  })
  if (!claimed.count) return
  const attempt = row.emailAttempts + 1
  const address = row.member.user.email
  if (!address || !isEmailAddress(address)) return void (await finish(id, { emailStatus: 'failed', emailError: 'MISSING_EMAIL', emailNextAt: null }))

  const taskKey = /\b[A-Z][A-Z0-9]*-\d+\b/.exec(row.title)?.[0]
  const base = appUrl()
  const blocks: EmailBlock[] = [{ type: 'text', text: row.summary && row.summary !== row.title ? row.summary : row.title }]
  // The work desks open on a room page: the workspace's channel, when the recipient is in it.
  if (base) {
    const channel = await db.workspaceChannel.findUnique({ where: { workspaceId: row.workspaceId }, select: { roomId: true } })
    const inRoom = channel && (await db.roomMember.findUnique({ where: { roomId_userId: { roomId: channel.roomId, userId: row.member.userId } }, select: { roomId: true } }))
    blocks.push(inRoom
      ? { type: 'button', label: taskKey ? `Open ${taskKey}` : 'Open the board', href: `${base}/room/${channel.roomId}?desk=calendar${taskKey ? `&ticket=${encodeURIComponent(taskKey)}` : ''}` }
      : { type: 'button', label: 'Open {{workspace.name}}', href: `${base}/` })
  }
  const rendered = renderEmail({
    subject: row.title,
    content: { version: 1, blocks },
    template: 'transactional',
    theme: 'company',
    values: await baseValues(row.workspace),
    footer: [`A task notification from {{workspace.name}}. To change which ones you get by email, open Calendar › For you.`],
  })

  let result
  try {
    const connection = await defaultConnection(row.workspaceId)
    result = await providerFor(connection).send(connection, { to: address, subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey: `task-notice:${id}` })
  } catch (err) {
    result = { ok: false as const, kind: 'transient' as const, code: 'SEND_ERROR', message: (err as Error).message }
  }
  if (result.ok) return void (await finish(id, { emailStatus: 'sent', emailedAt: new Date(), emailNextAt: null, emailError: null }))
  const retry = result.kind === 'transient' && attempt < MAX_ATTEMPTS
  await finish(id, retry ? { emailError: result.code.slice(0, 200) } : { emailStatus: 'failed', emailError: result.code.slice(0, 200), emailNextAt: null })
}

let inflight: Promise<void> = Promise.resolve()

/** Sends these rows now (after the commit), one at a time. Never throws: the sweep picks up what's left. */
export function sendTaskEmails(rowIds: string[]) {
  if (!rowIds.length) return
  inflight = inflight.then(async () => {
    for (const id of rowIds) await sendOne(id, new Date()).catch((err) => console.error('task email: send failed', err))
  })
}

/** Test hook: let immediate sends finish. */
export const drainTaskEmails = () => inflight

/** Retries pending rows whose next attempt is due. Returns the ids it tried. */
export async function sweepTaskEmails(now = new Date()) {
  const due = await db.inboxItem.findMany({
    where: { emailStatus: 'pending', OR: [{ emailNextAt: null, createdAt: { lt: new Date(now.getTime() - RETRY_MS) } }, { emailNextAt: { lte: now } }] },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true },
  })
  for (const { id } of due) await sendOne(id, now).catch((err) => console.error('task email: retry failed', err))
  return due.map((r) => r.id)
}

let timer: ReturnType<typeof setInterval> | null = null

/** Single instance, like the agents runner; AGENTS_SCHEDULER=off disables it too. */
export function startTaskEmailSweep(intervalMs = 60_000) {
  if (process.env.AGENTS_SCHEDULER === 'off' || timer) return false
  let busy = false
  timer = setInterval(() => {
    if (busy) return
    busy = true
    sweepTaskEmails()
      .catch((err) => console.error('task email: sweep failed', err))
      .finally(() => { busy = false })
  }, intervalMs)
  timer.unref()
  return true
}

export function stopTaskEmailSweep() {
  if (timer) clearInterval(timer)
  timer = null
}
