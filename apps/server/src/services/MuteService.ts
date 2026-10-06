// Personal, global mute (doc/08 I5, R7). Enforced on the server at every boundary
// that carries content to a viewer — list, single item, stream frames — by
// serializing a muted author's items through the hidden (tombstone) shape. Clients
// already drop content-less items from chat, stage and traversal.
import { db } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { toAuthor } from '../lib/serialize'
import { AsyncTtlCache } from '../lib/AsyncTtlCache'

const TTL_MS = 5_000
const cache = new AsyncTtlCache<string, Set<string>>(1_000, TTL_MS)

export class MuteService {
  /** The viewer's muted user ids. Cached briefly; invalidated on change. */
  async mutedBy(viewerId: string | null): Promise<Set<string>> {
    if (!viewerId) return new Set()
    return cache.get(viewerId, async () => {
      const rows = await db.userMute.findMany({ where: { userId: viewerId }, select: { mutedUserId: true } })
      const muted = new Set<string>()
      for (const row of rows) muted.add(row.mutedUserId)
      return muted
    })
  }

  async list(viewerId: string) {
    const rows = await db.userMute.findMany({
      where: { userId: viewerId },
      include: { muted: { include: { profile: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => toAuthor(r.muted))
  }

  async mute(viewerId: string, targetId: string) {
    if (viewerId === targetId) throw badRequest('You cannot mute yourself', 'MUTE_SELF')
    const target = await db.user.findFirst({ where: { id: targetId, deletedAt: null }, include: { profile: true } })
    if (!target) throw notFound('User not found')
    await db.userMute.upsert({
      where: { userId_mutedUserId: { userId: viewerId, mutedUserId: targetId } },
      create: { userId: viewerId, mutedUserId: targetId },
      update: {},
    })
    cache.delete(viewerId)
    return toAuthor(target)
  }

  async unmute(viewerId: string, targetId: string) {
    await db.userMute.deleteMany({ where: { userId: viewerId, mutedUserId: targetId } })
    cache.delete(viewerId)
  }
}

export const mutes = new MuteService()
