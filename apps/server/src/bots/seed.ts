// Idempotent: pack → bot User (kind bot, never logs in) + Profile + Bot + BotLines.
// Lines removed from a pack are disabled, not deleted, so old decisions still
// resolve. Run on boot and by `pnpm --filter server bots:seed`.
import { db } from '@project/db'
import type { Pack } from './pack'

export type SeededBot = { botId: string; userId: string; pack: Pack; assets: Map<string, string> /* asset key → messageId */ }

export async function seedPack(pack: Pack): Promise<SeededBot> {
  // One transaction so a concurrent test wipe can't leave a User without its Bot
  // (or a Bot without its lines) mid-seed.
  return db.$transaction(async (tx) => {
    let bot = await tx.bot.findUnique({ where: { handle: pack.handle } })
    if (!bot) {
      const user = await tx.user.create({
        data: { kind: 'bot', isGuest: false, profile: { create: { displayName: pack.displayName } } },
      })
      bot = await tx.bot.create({ data: { userId: user.id, handle: pack.handle, kind: pack.kind, persona: pack.persona, packVersion: pack.version } })
    } else {
      bot = await tx.bot.update({ where: { id: bot.id }, data: { kind: pack.kind, persona: pack.persona, packVersion: pack.version } })
      await tx.profile.upsert({
        where: { userId: bot.userId },
        create: { userId: bot.userId, displayName: pack.displayName },
        update: { displayName: pack.displayName },
      })
    }

    for (const line of pack.lines) {
      const data = {
        pool: line.pool, intents: line.intents, tags: line.tags, text: line.text, weight: line.weight,
        cooldownSec: line.cooldownSec, minGapSec: line.minGapSec, enabled: line.enabled,
      }
      await tx.botLine.upsert({ where: { botId_key: { botId: bot.id, key: line.key } }, create: { botId: bot.id, key: line.key, ...data }, update: data })
    }
    await tx.botLine.updateMany({ where: { botId: bot.id, key: { notIn: pack.lines.map((l) => l.key) } }, data: { enabled: false } })

    // Library assets: one bot-authored Message per clip, created once and placed again
    // and again (doc/08 I2). A changed video id gets a new Message; the old one stays
    // with the Items that already show it.
    const assets = new Map<string, string>()
    for (const a of pack.assets) {
      const data = { intents: a.intents, tags: a.tags, weight: a.weight, cooldownSec: a.cooldownSec, enabled: a.enabled }
      const existing = await tx.botAsset.findUnique({ where: { botId_key: { botId: bot.id, key: a.key } } })
      const current = existing
        ? await tx.message.findFirst({ where: { id: existing.messageId, deletedAt: null }, include: { media: { select: { externalId: true } } } })
        : null
      let messageId = current && current.media[0]?.externalId === a.youtube ? current.id : null
      if (!messageId) {
        const message = await tx.message.create({
          data: {
            authorId: bot.userId,
            text: a.text,
            media: { create: { ownerId: bot.userId, kind: 'video', source: 'youtube', externalId: a.youtube, title: a.title, embeddable: true, mimeType: 'video/x-youtube', size: 0 } },
          },
        })
        messageId = message.id
      } else if (current!.text !== a.text) {
        await tx.message.update({ where: { id: messageId }, data: { text: a.text } })
      }
      await tx.botAsset.upsert({ where: { botId_key: { botId: bot.id, key: a.key } }, create: { botId: bot.id, key: a.key, messageId, ...data }, update: { messageId, ...data } })
      assets.set(a.key, messageId)
    }
    await tx.botAsset.updateMany({ where: { botId: bot.id, key: { notIn: pack.assets.map((a) => a.key) } }, data: { enabled: false } })
    return { botId: bot.id, userId: bot.userId, pack, assets }
  })
}

export async function seedPacks(packs: Pack[]) {
  const seeded: SeededBot[] = []
  for (const pack of packs) seeded.push(await seedPack(pack))
  return seeded
}
