// Agent proposals (doc/13 §5): a typed change to one record, shown as before → after,
// applied only on a click. `kind` selects a registered handler — the only code that
// knows how to validate, apply and undo that change; `proposedChange` is data for it,
// never permission to mutate anything else. Chat and the record page render the same
// row; every state change re-journals its chat line so all viewers update live.
//
// Lifecycle (doc/13 §5.1):
//   pending → applied (Apply) → undone (Undo, only while the target is still at the
//             version Apply produced; otherwise Undo is refused and [Revert] proposes
//             putting the old value back as a new proposal)
//   pending → dismissed (Not now)
//   pending → expired (the target changed underneath it, or 14 days) → [Refresh]
import { db, type AgentProposal, type Prisma } from '@project/db'
import { badRequest, conflict, httpError, notFound } from '../lib/errors'
import { handlerOf, kinds, proposalInclude, toProposal, type DiffRow } from '../lib/proposal'
import { authorize, permit } from './workspacePolicy'
import type { WorkspaceCtx } from './WorkspaceService'
import { recordChange } from './roomChanges'
import { workspaceHost, HOST_HANDLE } from './WorkspaceHost'
import { postSays } from '../bots/flows/post'
import './proposalKinds' // registers the kinds
import { registerChoiceFlow } from '../bots/flows/registry'

export const PROPOSAL_FLOW = 'agent-proposal'
const TTL_MS = 14 * 86_400_000

export { registerProposalKind, toProposal, type ProposalHandler, type ProposalView, type DiffRow } from '../lib/proposal'

async function touch(row: AgentProposal, actorUserId: string) {
  if (!row.itemId) return
  const item = await db.item.findUnique({ where: { id: row.itemId }, select: { roomId: true } })
  if (item) await db.$transaction((tx) => recordChange(tx, item.roomId, row.itemId!, actorUserId))
}

export class ProposalService {
  /** Proposes a change and (by default) posts it as a card in the workspace channel. */
  async propose(ctx: WorkspaceCtx, workspaceId: string, input: { kind: string; targetId: string; change: unknown; evidence?: unknown; post?: boolean }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'workspace.read') // outsiders: 404 first
    const handler = handlerOf(input.kind)
    permit(actor, handler.readVerb)
    const change = handler.validate(input.change)
    const version = await handler.version(workspaceId, input.targetId)
    if (version === null) throw notFound('Target not found')
    const { title, diff } = await handler.describe(workspaceId, input.targetId, change)
    if (diff.every((d) => d.before === d.after)) throw badRequest('That is what it already says', 'NO_CHANGE')
    const row = await db.agentProposal.create({
      data: {
        workspaceId, kind: input.kind, targetType: handler.targetType, targetId: input.targetId, baseVersion: version,
        proposedChange: change as Prisma.InputJsonValue, diff: { title, rows: diff } as Prisma.InputJsonValue,
        evidence: (input.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
        createdByMemberId: actor.member.id, expiresAt: new Date(Date.now() + TTL_MS),
      },
    })
    if (input.post !== false) await this.postCard(row, ctx.user.id)
    return this.get(ctx.user.id, workspaceId, row.id)
  }

  // The chat card: one line in the channel that renders this proposal.
  private async postCard(row: AgentProposal, actorUserId: string) {
    const bot = await db.bot.findUnique({ where: { handle: HOST_HANDLE }, select: { userId: true } })
    if (!bot) return
    const channel = await workspaceHost.ensureChannel(row.workspaceId)
    const rows = ((row.diff as { rows: DiffRow[] }).rows ?? [])
    const text = `${(row.diff as { title: string }).title}\n${rows.map((d) => `${d.label}: ${d.before || '—'} → ${d.after || '—'}`).join('\n')}`
    await postSays(bot.userId, channel.roomId, true, PROPOSAL_FLOW, [{
      text,
      onPosted: async (itemId) => {
        const updated = await db.agentProposal.update({ where: { id: row.id }, data: { itemId } })
        await touch(updated, actorUserId) // the line now renders the card
      },
    }])
  }

  /** One proposal, with its status brought up to date (lazy expiry). */
  async get(userId: string, workspaceId: string, id: string) {
    const row = await this.load(userId, workspaceId, id)
    return toProposal(await this.settle(row, userId))
  }

  async list(userId: string, workspaceId: string, filter: { targetType?: string; targetId?: string; status?: AgentProposal['status'] }) {
    const actor = await authorize(userId, workspaceId, 'workspace.read')
    const rows = await db.agentProposal.findMany({
      where: { workspaceId, ...(filter.targetType ? { targetType: filter.targetType } : {}), ...(filter.targetId ? { targetId: filter.targetId } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' }, take: 50, include: proposalInclude,
    })
    const visible = rows.filter((r) => { try { permit(actor, handlerOf(r.kind).readVerb); return true } catch { return false } })
    const settled = await Promise.all(visible.map((r) => this.settle(r, userId)))
    return settled.map(toProposal)
  }

  async apply(ctx: WorkspaceCtx, workspaceId: string, id: string) {
    const row = await this.load(ctx.user.id, workspaceId, id)
    const handler = handlerOf(row.kind)
    const actor = await authorize(ctx.user.id, workspaceId, handler.applyVerb)
    if (row.status === 'applied') return toProposal(row) // idempotent
    const current = await this.settle(row, ctx.user.id)
    if (current.status === 'expired') throw conflict('The record changed since this was proposed; refresh it', 'PROPOSAL_EXPIRED')
    if (current.status !== 'pending') throw conflict(`This proposal was ${current.status}`, 'PROPOSAL_DECIDED')
    // Claim it: only one Apply runs (decidedAt marks it in progress).
    const claimed = await db.agentProposal.updateMany({ where: { id, status: 'pending', decidedAt: null }, data: { decidedAt: new Date(), decidedByMemberId: actor.member.id } })
    if (!claimed.count) return this.get(ctx.user.id, workspaceId, id)
    let outcome: { resultVersion: number; undoData: unknown }
    try {
      outcome = await handler.apply(ctx, workspaceId, row.targetId, handler.validate(row.proposedChange), row.baseVersion)
    } catch (error) {
      const stale = (error as { statusCode?: number }).statusCode === 409
      const back = await db.agentProposal.update({ where: { id }, data: stale ? { status: 'expired' } : { decidedAt: null, decidedByMemberId: null } })
      if (stale) await touch(back, ctx.user.id)
      if (stale) throw conflict('The record changed since this was proposed; refresh it', 'PROPOSAL_EXPIRED')
      throw error
    }
    const applied = await db.agentProposal.update({
      where: { id }, data: { status: 'applied', resultVersion: outcome.resultVersion, undoData: (outcome.undoData ?? undefined) as Prisma.InputJsonValue | undefined },
    })
    await touch(applied, ctx.user.id)
    await this.expireStale(workspaceId, row.targetType, row.targetId, ctx.user.id)
    return this.get(ctx.user.id, workspaceId, id)
  }

  async dismiss(ctx: WorkspaceCtx, workspaceId: string, id: string) {
    const row = await this.load(ctx.user.id, workspaceId, id)
    const actor = await authorize(ctx.user.id, workspaceId, handlerOf(row.kind).applyVerb)
    const done = await db.agentProposal.updateMany({ where: { id, status: 'pending', decidedAt: null }, data: { status: 'dismissed', decidedAt: new Date(), decidedByMemberId: actor.member.id } })
    if (done.count) await touch(row, ctx.user.id)
    return this.get(ctx.user.id, workspaceId, id)
  }

  /** Reverses an applied proposal — only if the target is still exactly at the version
   *  Apply produced. Someone's newer work is never reversed: 409 PROPOSAL_UNDO_STALE,
   *  and [Revert] can propose putting the old value back instead. */
  async undo(ctx: WorkspaceCtx, workspaceId: string, id: string) {
    const row = await this.load(ctx.user.id, workspaceId, id)
    const handler = handlerOf(row.kind)
    const actor = await authorize(ctx.user.id, workspaceId, handler.applyVerb)
    if (row.status === 'undone') return toProposal(row)
    if (row.status !== 'applied' || row.resultVersion === null) throw conflict('Only an applied proposal can be undone', 'PROPOSAL_NOT_APPLIED')
    if ((await handler.version(workspaceId, row.targetId)) !== row.resultVersion) throw this.undoStale()
    try {
      await handler.undo(ctx, workspaceId, row.targetId, row.undoData, row.resultVersion)
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409) throw this.undoStale()
      throw error
    }
    const undone = await db.agentProposal.update({ where: { id }, data: { status: 'undone', decidedAt: new Date(), decidedByMemberId: actor.member.id } })
    await touch(undone, ctx.user.id)
    await this.expireStale(workspaceId, row.targetType, row.targetId, ctx.user.id)
    return this.get(ctx.user.id, workspaceId, id)
  }

  private undoStale() {
    return httpError(409, 'It has changed since; undoing now would reverse newer work. Propose putting the old value back instead.', 'PROPOSAL_UNDO_STALE')
  }

  /** A new proposal that restores what an applied one replaced, against today's record. */
  async revert(ctx: WorkspaceCtx, workspaceId: string, id: string) {
    const row = await this.load(ctx.user.id, workspaceId, id)
    if (row.status !== 'applied' || !row.undoData) throw conflict('Only an applied proposal can be reverted', 'PROPOSAL_NOT_APPLIED')
    return this.propose(ctx, workspaceId, { kind: row.kind, targetId: row.targetId, change: handlerOf(row.kind).revert(row.undoData) })
  }

  /** The same change again, against the record as it is now. */
  async refresh(ctx: WorkspaceCtx, workspaceId: string, id: string) {
    const row = await this.load(ctx.user.id, workspaceId, id)
    if ((await this.settle(row, ctx.user.id)).status !== 'expired') throw conflict('Only an expired proposal can be refreshed', 'PROPOSAL_NOT_EXPIRED')
    return this.propose(ctx, workspaceId, { kind: row.kind, targetId: row.targetId, change: row.proposedChange })
  }

  /** Any write to a target makes its other pending proposals stale. Writers call this;
   *  reads also check (settle), so a missed call only delays it. */
  async expireStale(workspaceId: string, targetType: string, targetId: string, actorUserId: string) {
    const pending = await db.agentProposal.findMany({ where: { workspaceId, targetType, targetId, status: 'pending', decidedAt: null } })
    for (const row of pending) await this.settle(row, actorUserId)
  }

  private async load(userId: string, workspaceId: string, id: string) {
    const actor = await authorize(userId, workspaceId, 'workspace.read')
    const row = await db.agentProposal.findFirst({ where: { id, workspaceId }, include: proposalInclude })
    if (!row) throw notFound('Proposal not found')
    try { permit(actor, handlerOf(row.kind).readVerb) } catch { throw notFound('Proposal not found') }
    return row
  }

  // Lazy expiry: a pending proposal whose target moved past its base version, or whose
  // time ran out, becomes expired (and its card updates).
  private async settle<R extends AgentProposal>(row: R, actorUserId: string): Promise<R> {
    if (row.status !== 'pending' || row.decidedAt) return row
    const handler = kinds.get(row.kind)
    const moved = handler ? (await handler.version(row.workspaceId, row.targetId)) !== row.baseVersion : false
    if (!moved && row.expiresAt.getTime() > Date.now()) return row
    const done = await db.agentProposal.updateMany({ where: { id: row.id, status: 'pending', decidedAt: null }, data: { status: 'expired' } })
    if (done.count) await touch(row, actorUserId)
    return { ...row, status: 'expired' }
  }
}

export const proposals = new ProposalService()

/** Registers the chat flow proposal cards post under (workflow allowance). */
export function registerProposalFlow() {
  return registerChoiceFlow(PROPOSAL_FLOW, { advance: () => [] })
}
