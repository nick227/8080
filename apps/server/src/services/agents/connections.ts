// Email connections — the workspace's sender identities (docs/agents/07 decisions
// 1–4). Every workspace has "Send with 8080" from creation; nobody creates it. Agents
// point at a connection (or the default); credentials never leave this layer.
import { db, Prisma, type EmailConnection } from '@project/db'
import { badRequest, notFound } from '../../lib/errors'
import { runAction } from '../actions'
import { authorize } from '../workspacePolicy'
import { memberActor, type WorkspaceCtx } from '../WorkspaceService'
import { isEmailAddress, platformIdentity, providerFor } from './email'

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
  }
}

export class EmailConnectionService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'email.read')
    await defaultConnection(workspaceId)
    const rows = await db.emailConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } })
    return rows.map(toEmailConnection)
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, connectionId: string, input: { displayName?: string; replyTo?: string | null }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'email.manage')
    const displayName = input.displayName?.trim()
    if (input.displayName !== undefined && !displayName) throw badRequest('Enter the name people see', 'INVALID_DISPLAY_NAME')
    const replyTo = input.replyTo === undefined ? undefined : input.replyTo?.trim() || null
    if (replyTo && !isEmailAddress(replyTo)) throw badRequest('Enter a valid reply-to email address', 'INVALID_REPLY_TO')
    const before = await db.emailConnection.findFirst({ where: { id: connectionId, workspaceId } })
    if (!before) throw notFound()
    return runAction(
      { action: 'emailConnection.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'emailConnection', id: connectionId } },
      async (tx) => {
        const after = await tx.emailConnection.update({ where: { id: connectionId }, data: { displayName, replyTo } })
        const changes: Record<string, [unknown, unknown]> = {}
        if (before.displayName !== after.displayName) changes.displayName = [before.displayName, after.displayName]
        if (before.replyTo !== after.replyTo) changes.replyTo = [before.replyTo, after.replyTo]
        return { value: toEmailConnection(after), changes }
      },
    )
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
