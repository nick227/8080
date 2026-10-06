// chatbot as the workspace's host (doc/12 §3): one shared, transparent channel per
// workspace. Everyone who becomes an active member is welcomed there, publicly and
// once. The creator's welcome opens the company-profile run; everyone else gets a
// short intro. Guests are never workspace members, so they never see the channel.
import { db, type Prisma } from '@project/db'
import { events, type DomainEvents } from './events'
import { authorize } from './workspacePolicy'
import { registerChoiceFlow, type ChoiceFlow, type FlowSay } from '../bots/flows/registry'
import { postSays } from '../bots/flows/post'
import { registerActivityFlow } from './activityEvent'
import { COMPANY_PROFILE, companyProfileFlow, extract, generate, startOffer, startRun, textAnswer } from '../bots/flows/companyProfile'
import { PROFILE_FIX, profileFixFlow, profileFixText } from '../bots/flows/profileFix'
import { registerProposalFlow } from './ProposalService'

export const HOST_HANDLE = 'chatbot'
export const WELCOME = 'workspace-welcome'

const memberWelcome = (name: string, userId: string): FlowSay => ({
  text: `Welcome, ${name}.`,
  offer: { step: 'intro', options: [{ id: 'intro', label: 'See what I can do' }], forUserId: userId },
})

const welcomeFlow: ChoiceFlow = {
  advance: () => [{
    text: 'I welcome everyone who joins, and I write documents from the company profile once the workspace owner has set it up. What I do here, everyone can see.',
  }],
}

async function hostBot() {
  return db.bot.findUnique({ where: { handle: HOST_HANDLE }, select: { id: true, userId: true, enabled: true } })
}

export class WorkspaceHost {
  /** The workspace's channel room, created on first use (one per workspace, race-safe). */
  async ensureChannel(workspaceId: string) {
    const existing = await db.workspaceChannel.findUnique({ where: { workspaceId } })
    if (existing) return existing
    return db.$transaction(async (tx) => {
      // The workspace row lock serializes first use; whoever waits sees the channel.
      const [ws] = await tx.$queryRaw<{ name: string; createdById: string }[]>`SELECT name, createdById FROM Workspace WHERE id = ${workspaceId} FOR UPDATE`
      if (!ws) throw new Error(`No workspace ${workspaceId}`)
      const again = await tx.workspaceChannel.findUnique({ where: { workspaceId } })
      if (again) return again
      const room = await tx.room.create({
        data: {
          title: ws.name,
          description: 'Workspace channel — what chatbot does for this workspace, in the open.',
          visibility: 'private',
          ownerId: ws.createdById,
          members: { create: { userId: ws.createdById, role: 'owner' } },
        },
      })
      return tx.workspaceChannel.create({ data: { workspaceId, roomId: room.id } })
    })
  }

  /** A member arrives: join them to the channel and welcome them once. */
  async join(workspaceId: string, userId: string, memberId: string) {
    const channel = await this.ensureChannel(workspaceId)
    await db.roomMember.upsert({ where: { roomId_userId: { roomId: channel.roomId, userId } }, create: { roomId: channel.roomId, userId }, update: {} })
    await this.welcome(workspaceId, channel.roomId, userId, memberId)
    return { roomId: channel.roomId }
  }

  /** POST /workspaces/{id}/channel: any active member; welcomes on first open too, so
   *  workspaces made before the channel existed get one. */
  async open(userId: string, workspaceId: string) {
    const actor = await authorize(userId, workspaceId, 'workspace.read')
    return this.join(workspaceId, userId, actor.member.id)
  }

  private async welcome(workspaceId: string, roomId: string, userId: string, memberId: string) {
    const bot = await hostBot()
    if (!bot?.enabled) return
    const [workspace, user] = await Promise.all([
      db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { createdById: true } }),
      db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }),
    ])
    // Claimed once per (bot, room, person); the claim is the dedupe across restarts.
    // A welcome that couldn't be posted (BOTS=off, allowance spent) gives the claim
    // back, so the next open tries again.
    const key = `welcome:${userId}`
    try {
      await db.botOnce.create({ data: { botId: bot.id, roomId, key, outcome: 'posted' } })
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') return
      throw error
    }
    const name = user.profile?.displayName ?? 'there'
    let posted: string[]
    if (workspace.createdById === userId) {
      const open = await db.workflowRun.findFirst({ where: { workflowKey: COMPANY_PROFILE, roomId, userId, status: { in: ['waiting', 'paused'] }, stepId: 'start' } })
      if (!open) await startRun({ workspaceId, memberId, userId, roomId })
      posted = await postSays(bot.userId, roomId, true, COMPANY_PROFILE, [startOffer(name, userId)])
    } else {
      posted = await postSays(bot.userId, roomId, true, WELCOME, [memberWelcome(name, userId)])
    }
    if (posted.length === 0) await db.botOnce.deleteMany({ where: { botId: bot.id, roomId, key } })
  }

  /** A typed message in a channel may be the answer the creator's run is waiting for. */
  async onItem(e: DomainEvents['item.created']) {
    if (e.actorKind !== 'human') return
    const channel = await db.workspaceChannel.findUnique({ where: { roomId: e.roomId } })
    if (!channel) return
    const hasMedia = (await db.media.count({ where: { message: { items: { some: { id: e.itemId } } } } })) > 0
    const advanced = await textAnswer({ roomId: e.roomId, itemId: e.itemId, actorId: e.actorId, text: e.text, hasMedia })
    const bot = await hostBot()
    if (!bot) return
    if (!advanced) {
      const fix = await profileFixText({ roomId: e.roomId, itemId: e.itemId, actorId: e.actorId, text: e.text })
      if (fix?.length) await postSays(bot.userId, e.roomId, e.chat, PROFILE_FIX, fix)
      return
    }
    await postSays(bot.userId, e.roomId, e.chat, COMPANY_PROFILE, advanced.says)
    if (advanced.extract) await postSays(bot.userId, e.roomId, e.chat, COMPANY_PROFILE, await extract(e.roomId, e.actorId))
    if (advanced.generate) await postSays(bot.userId, e.roomId, e.chat, COMPANY_PROFILE, await generate(e.roomId, e.actorId))
  }
}

export const workspaceHost = new WorkspaceHost()

/** Wires the host into the server: flows registered, welcomes on activation, typed
 *  answers from channels. `idle()` waits for in-flight handlers (tests). */
export function startWorkspaceHost() {
  const pending = new Set<Promise<unknown>>()
  const track = (p: Promise<unknown>) => {
    pending.add(p)
    void p.catch((error) => console.error('[host] handler failed', error)).finally(() => pending.delete(p))
    return p
  }
  const off = [
    registerChoiceFlow(COMPANY_PROFILE, companyProfileFlow),
    registerChoiceFlow(WELCOME, welcomeFlow),
    registerChoiceFlow(PROFILE_FIX, profileFixFlow),
    registerProposalFlow(),
    registerActivityFlow(),
    events.on('workspace.member.activated', (e) => { void track(workspaceHost.join(e.workspaceId, e.userId, e.memberId)) }),
    events.on('item.created', (e) => { void track(workspaceHost.onItem(e)) }),
  ]
  return {
    async idle() {
      // Handlers fire on the next tick; give them a moment to register, then drain.
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setImmediate(r))
        while (pending.size) await Promise.allSettled([...pending])
      }
    },
    stop() { for (const f of off) f() },
  }
}
