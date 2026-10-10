// Email connections — the workspace's sender identities (docs/agents/07 decisions
// 1–4). Every workspace has "Send with 8080" from creation; nobody creates it. Agents
// point at a connection (or the default); credentials never leave this layer.
import { db, Prisma, type EmailConnection } from '@project/db'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { decryptSecret, encryptSecret } from '../../lib/secrets'
import { runAction } from '../actions'
import { authorize } from '../workspacePolicy'
import { memberActor, type WorkspaceCtx } from '../WorkspaceService'
import { isEmailAddress, platformIdentity, providerFor } from './email'
import { smtpHostProblem, type SmtpSecret, type SmtpSecurity } from './email/smtp'

export type SmtpInput = { host: string; port: number; security: SmtpSecurity; username: string; password: string }
export type CreateConnectionInput = { strategy: 'smtp'; displayName: string; fromAddress: string; replyTo?: string | null; smtp: SmtpInput; makeDefault?: boolean }
export type UpdateConnectionInput = {
  displayName?: string
  replyTo?: string | null
  fromAddress?: string
  /** Own senders only; omitted fields keep their value (the password is write-only). */
  smtp?: Partial<SmtpInput>
  makeDefault?: boolean
}

async function smtpProblem(smtp: SmtpInput) {
  if (!smtp.username.trim() || !smtp.password) return 'Enter the mailbox user name and password'
  if (smtp.security !== 'implicit' && smtp.security !== 'starttls') return 'Choose how the connection is secured'
  return smtpHostProblem(smtp.host.trim(), smtp.port)
}

/** Public SMTP details for editing (never the password). */
function smtpDetails(c: EmailConnection) {
  if (c.strategy !== 'smtp' || !c.secret) return null
  try {
    const s = decryptSecret<SmtpSecret>(c.secret)
    return { host: s.host, port: s.port, security: s.security, username: s.username }
  } catch {
    return null
  }
}

type Tx = Prisma.TransactionClient

export const PLATFORM_LABEL = 'Send with 8080'

/** The platform connection a new workspace starts with (inside its create transaction). */
export function createPlatformConnection(tx: Tx, workspace: { id: string; name: string }, replyTo: string | null, memberId: string | null) {
  return tx.emailConnection.create({
    data: {
      workspaceId: workspace.id,
      strategy: 'platform',
      defaultFor: workspace.id,
      displayName: workspace.name.slice(0, 120),
      replyTo: replyTo && isEmailAddress(replyTo) ? replyTo : null,
      createdByMemberId: memberId,
    },
  })
}

/**
 * The workspace's default sender, creating the platform connection for a workspace
 * that predates it (Reply-To = the creator's account email). Idempotent and race-safe:
 * `defaultFor` is unique.
 */
export async function defaultConnection(workspaceId: string): Promise<EmailConnection> {
  const found = await db.emailConnection.findUnique({ where: { defaultFor: workspaceId } })
  if (found) return found
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, include: { createdBy: { select: { email: true } } } })
  const owner = await db.workspaceMember.findFirst({ where: { workspaceId, userId: workspace.createdById }, select: { id: true } })
  try {
    return await db.$transaction((tx) => createPlatformConnection(tx, workspace, workspace.createdBy.email, owner?.id ?? null))
  } catch (err) {
    if ((err as Prisma.PrismaClientKnownRequestError).code !== 'P2002') throw err
    return db.emailConnection.findUniqueOrThrow({ where: { defaultFor: workspaceId } })
  }
}

/** The connection an Agent sends with: its own choice, else the workspace default. */
export async function agentConnection(agent: { workspaceId: string; emailConnectionId: string | null }) {
  if (agent.emailConnectionId) {
    const own = await db.emailConnection.findFirst({ where: { id: agent.emailConnectionId, workspaceId: agent.workspaceId } })
    if (own) return own
  }
  return defaultConnection(agent.workspaceId)
}

export function toEmailConnection(c: EmailConnection) {
  const platform = c.strategy === 'platform'
  const fromAddress = platform ? (platformIdentity(c)?.fromAddress ?? null) : c.fromAddress
  return {
    id: c.id,
    mode: platform ? ('platform' as const) : ('own' as const),
    strategy: c.strategy,
    label: platform ? PLATFORM_LABEL : `${c.displayName} · ${c.fromAddress ?? ''}`.trim(),
    displayName: c.displayName,
    fromAddress,
    replyTo: c.replyTo,
    status: c.status,
    isDefault: c.defaultFor === c.workspaceId,
    lastTestedAt: c.lastTestedAt,
    lastError: c.lastError,
    smtp: smtpDetails(c),
  }
}

/** Makes `connectionId` the workspace default (the unique `defaultFor` moves). */
async function setDefault(tx: Tx, workspaceId: string, connectionId: string) {
  await tx.emailConnection.updateMany({ where: { defaultFor: workspaceId, NOT: { id: connectionId } }, data: { defaultFor: null } })
  await tx.emailConnection.update({ where: { id: connectionId }, data: { defaultFor: workspaceId } })
}

export class EmailConnectionService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'email.read')
    await defaultConnection(workspaceId)
    const rows = await db.emailConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } })
    return rows.map(toEmailConnection)
  }

  /** Adds or updates a Google/Gmail OAuth email connection */
  async createOrUpdateGoogleConnection(input: {
    workspaceId: string
    memberId: string
    emailAddress: string
    accessToken: string
    refreshToken: string | null
    expiresIn: number
    scope?: string
  }) {
    const { workspaceId, memberId, emailAddress, accessToken, refreshToken, expiresIn, scope } = input
    const normalizedEmail = emailAddress.toLowerCase().trim()

    const existing = await db.emailConnection.findFirst({
      where: { workspaceId, strategy: 'google', fromAddress: normalizedEmail },
    })

    let finalRefreshToken = refreshToken
    if (!finalRefreshToken && existing?.secret) {
      try {
        const oldSecret = decryptSecret<{ refreshToken?: string }>(existing.secret)
        if (oldSecret.refreshToken) finalRefreshToken = oldSecret.refreshToken
      } catch {
        // ignore
      }
    }

    const secretPayload = {
      accessToken,
      refreshToken: finalRefreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      emailAddress: normalizedEmail,
      scope,
    }

    const encryptedSecret = encryptSecret(secretPayload)
    const displayName = `Gmail (${normalizedEmail})`

    if (existing) {
      const updated = await db.emailConnection.update({
        where: { id: existing.id },
        data: {
          displayName,
          secret: encryptedSecret,
          status: 'active',
          lastError: null,
          lastTestedAt: new Date(),
        },
      })
      return toEmailConnection(updated)
    }

    const created = await db.emailConnection.create({
      data: {
        workspaceId,
        strategy: 'google',
        displayName,
        fromAddress: normalizedEmail,
        secret: encryptedSecret,
        createdByMemberId: memberId,
        status: 'active',
        lastTestedAt: new Date(),
      },
    })
    return toEmailConnection(created)
  }

  /** Adds an own sender ("Use my own email/domain"). Not the default unless asked. */
  async create(ctx: WorkspaceCtx, workspaceId: string, input: CreateConnectionInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'email.manage')
    if (input.strategy !== 'smtp') throw badRequest('That way of connecting is not available yet', 'UNSUPPORTED_STRATEGY')
    const displayName = input.displayName.trim()
    const fromAddress = input.fromAddress.trim()
    const replyTo = input.replyTo?.trim() || null
    if (!displayName) throw badRequest('Enter the name people see', 'INVALID_DISPLAY_NAME')
    if (!isEmailAddress(fromAddress)) throw badRequest('Enter the email address to send from', 'INVALID_FROM')
    if (replyTo && !isEmailAddress(replyTo)) throw badRequest('Enter a valid reply-to email address', 'INVALID_REPLY_TO')
    const smtp = { ...input.smtp, host: input.smtp.host.trim(), username: input.smtp.username.trim() }
    const problem = await smtpProblem(smtp)
    if (problem) throw badRequest(problem, 'INVALID_SMTP')
    return runAction(
      // The password never enters the audit row.
      { action: 'emailConnection.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { strategy: 'smtp', displayName, fromAddress, replyTo, host: smtp.host, port: smtp.port }, target: { type: 'emailConnection' } },
      async (tx) => {
        const created = await tx.emailConnection.create({
          data: { workspaceId, strategy: 'smtp', displayName, fromAddress, replyTo, secret: encryptSecret(smtp satisfies SmtpSecret), createdByMemberId: actor.member.id },
        })
        if (input.makeDefault) await setDefault(tx, workspaceId, created.id)
        const row = await tx.emailConnection.findUniqueOrThrow({ where: { id: created.id } })
        return { value: toEmailConnection(row), targetId: created.id }
      },
    )
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, connectionId: string, input: UpdateConnectionInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'email.manage')
    const displayName = input.displayName?.trim()
    if (input.displayName !== undefined && !displayName) throw badRequest('Enter the name people see', 'INVALID_DISPLAY_NAME')
    const replyTo = input.replyTo === undefined ? undefined : input.replyTo?.trim() || null
    if (replyTo && !isEmailAddress(replyTo)) throw badRequest('Enter a valid reply-to email address', 'INVALID_REPLY_TO')
    const before = await db.emailConnection.findFirst({ where: { id: connectionId, workspaceId } })
    if (!before) throw notFound()
    const own = before.strategy !== 'platform'
    if (!own && (input.fromAddress !== undefined || input.smtp)) throw badRequest('Send with 8080 uses the 8080 address; change the reply-to instead', 'PLATFORM_FIXED')
    const fromAddress = input.fromAddress?.trim()
    if (fromAddress !== undefined && !isEmailAddress(fromAddress)) throw badRequest('Enter the email address to send from', 'INVALID_FROM')
    let secret: string | undefined
    if (input.smtp && before.strategy === 'smtp') {
      const current = before.secret ? decryptSecret<SmtpSecret>(before.secret) : null
      const next = { ...current, ...input.smtp } as SmtpInput
      next.host = (next.host ?? '').trim()
      next.username = (next.username ?? '').trim()
      const problem = await smtpProblem(next)
      if (problem) throw badRequest(problem, 'INVALID_SMTP')
      secret = encryptSecret(next satisfies SmtpSecret)
    }
    return runAction(
      {
        action: 'emailConnection.update',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input: { displayName: input.displayName, replyTo: input.replyTo, fromAddress: input.fromAddress, makeDefault: input.makeDefault, smtpChanged: !!input.smtp },
        target: { type: 'emailConnection', id: connectionId },
      },
      async (tx) => {
        await tx.emailConnection.update({
          where: { id: connectionId },
          // New credentials clear an old failure; the next test or send decides again.
          data: { displayName, replyTo, fromAddress, ...(secret ? { secret, status: 'active' as const, lastError: null } : {}) },
        })
        if (input.makeDefault) await setDefault(tx, workspaceId, connectionId)
        const after = await tx.emailConnection.findUniqueOrThrow({ where: { id: connectionId } })
        const changes: Record<string, [unknown, unknown]> = {}
        for (const f of ['displayName', 'replyTo', 'fromAddress', 'defaultFor'] as const) if (before[f] !== after[f]) changes[f] = [before[f], after[f]]
        if (secret) changes.smtp = ['(hidden)', '(changed)']
        return { value: toEmailConnection(after), changes }
      },
    )
  }

  /** Removes an own sender. Agents that used it fall back to the default. */
  async remove(ctx: WorkspaceCtx, workspaceId: string, connectionId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'email.manage')
    const connection = await db.emailConnection.findFirst({ where: { id: connectionId, workspaceId } })
    if (!connection) throw notFound()
    if (connection.strategy === 'platform') throw conflict('Send with 8080 is always available and can’t be removed', 'PLATFORM_FIXED')
    if (connection.defaultFor) throw conflict('Make another sender the default first', 'DEFAULT_SENDER')
    const agents = await db.agent.count({ where: { workspaceId, emailConnectionId: connectionId } })
    await runAction(
      { action: 'emailConnection.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { connectionId }, target: { type: 'emailConnection', id: connectionId } },
      async (tx) => {
        await tx.emailConnection.delete({ where: { id: connectionId } })
        return { value: null, changes: { displayName: [connection.displayName, null] }, result: { agentsMovedToDefault: agents } }
      },
    )
    return { removed: true, agentsMovedToDefault: agents }
  }

  /** Checks the connection, then sends a short test email to the caller's own address. */
  async test(ctx: WorkspaceCtx, workspaceId: string, connectionId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'email.manage')
    const connection = await db.emailConnection.findFirst({ where: { id: connectionId, workspaceId } })
    if (!connection) throw notFound()
    const to = ctx.user.email as string | null
    if (!to) throw badRequest('Your account has no email address to send the test to', 'NO_TEST_ADDRESS')

    const provider = providerFor(connection)
    const checked = await provider.test(connection)
    const sent = checked.ok
      ? await provider.send(connection, {
          to,
          subject: `Test from ${connection.displayName}`,
          html: '',
          text: `This is a test from ${connection.displayName}. Replies go to ${connection.replyTo ?? 'the sending address'}.\n`,
        })
      : null
    const error = !checked.ok ? checked : sent && !sent.ok ? sent : null
    return runAction(
      { action: 'emailConnection.test', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { to }, target: { type: 'emailConnection', id: connectionId } },
      async (tx) => {
        const after = await tx.emailConnection.update({
          where: { id: connectionId },
          data: {
            lastTestedAt: new Date(),
            lastError: error ? error.message.slice(0, 500) : null,
            // A failed login marks an own connection; the platform is ours to fix.
            ...(error && 'kind' in error && error.kind === 'auth' && connection.strategy !== 'platform' ? { status: 'needs_attention' as const } : {}),
            ...(!error && connection.status === 'needs_attention' ? { status: 'active' as const } : {}),
          },
        })
        return {
          value: {
            ok: !error,
            sentTo: error ? null : to,
            providerMessageId: sent?.ok ? sent.providerMessageId : null,
            error: error ? { code: error.code, message: error.message } : null,
            connection: toEmailConnection(after),
          },
          result: { ok: !error, code: error?.code ?? null, providerMessageId: sent?.ok ? sent.providerMessageId : null },
        }
      },
    )
  }
}
