// Workspace attention events (doc/11 revised). One row per business event for the
// whole workspace. Presentation is optional and lands in the shared bot channel —
// not a per-member InboxItem fan-out.
import { db, Prisma } from '@project/db'
import type { MessageLink } from '../lib/choice'
import { postSays } from '../bots/flows/post'
import { registerChoiceFlow, type ChoiceFlow } from '../bots/flows/registry'
import { workspaceHost, HOST_HANDLE } from './WorkspaceHost'

export const ACTIVITY = 'workspace-activity'

export type ActivityEventInput = {
  workspaceId: string
  type: string
  title: string
  summary: string
  sourceType: string
  sourceId: string
  dedupeKey: string
  links?: MessageLink[]
  actorMemberId?: string | null
  deliverAt?: Date
  /** The channel line that already announces this (e.g. a workflow's own summary). The
   *  event points at it and posts nothing more — one line per event, not two. */
  itemId?: string
}

const activityFlow: ChoiceFlow = { advance: () => [] }

export function registerActivityFlow() {
  return registerChoiceFlow(ACTIVITY, activityFlow)
}

export async function recordActivityEvent(input: ActivityEventInput) {
  const deliverAt = input.deliverAt ?? new Date()
  const title = input.title.trim().slice(0, 200)
  const summary = input.summary.trim().slice(0, 500)
  try {
    await db.activityEvent.create({
      data: {
        workspaceId: input.workspaceId,
        type: input.type,
        title,
        summary,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        links: (input.links ?? []) as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey,
        actorMemberId: input.actorMemberId ?? null,
        deliverAt,
        itemId: input.itemId ?? null,
      },
    })
  } catch (error) {
    if ((error as Prisma.PrismaClientKnownRequestError).code !== 'P2002') throw error
  }
  const row = await db.activityEvent.findUniqueOrThrow({
    where: { workspaceId_dedupeKey: { workspaceId: input.workspaceId, dedupeKey: input.dedupeKey } },
  })
  if (row.itemId || row.deliverAt.getTime() > Date.now()) return row
  return presentActivityEvent(row.id)
}

async function presentActivityEvent(id: string) {
  const row = await db.activityEvent.findUniqueOrThrow({ where: { id } })
  if (row.itemId) return row
  const channel = await workspaceHost.ensureChannel(row.workspaceId)
  const bot = await db.bot.findUnique({ where: { handle: HOST_HANDLE }, select: { userId: true, enabled: true } })
  if (!bot?.enabled) return row
  const links = (Array.isArray(row.links) ? row.links : []) as MessageLink[]
  const text = row.summary ? `${row.title}\n${row.summary}` : row.title
  const posted = await postSays(bot.userId, channel.roomId, true, ACTIVITY, [{ text, links: links.length ? links : undefined }])
  const itemId = posted[0]
  if (!itemId) {
    console.error('activity event: channel line not posted', { id: row.id, workspaceId: row.workspaceId, roomId: channel.roomId })
    return row
  }
  return db.activityEvent.update({ where: { id: row.id }, data: { itemId } })
}
