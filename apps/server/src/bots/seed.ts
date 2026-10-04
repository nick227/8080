// Idempotent: pack → bot User (kind bot, never logs in) + Profile + Bot + BotLines.
// Lines removed from a pack are disabled, not deleted, so old decisions still
// resolve. Run on boot and by `pnpm --filter server bots:seed`.
import { db } from '@project/db'
import type { Pack } from './pack'

export type SeededBot = { botId: string; userId: string; pack: Pack }

export async function seedPack(pack: Pack): Promise<SeededBot> {
  let bot = await db.bot.findUnique({ where: { handle: pack.handle } })
  if (!bot) {
    const user = await db.user.create({
      data: { kind: 'bot', isGuest: false, profile: { create: { displayName: pack.displayName } } },
    })
    bot = await db.bot.create({ data: { userId: user.id, handle: pack.handle, kind: pack.kind, persona: pack.persona, packVersion: pack.version } })
  } else {
    bot = await db.bot.update({ where: { id: bot.id }, data: { kind: pack.kind, persona: pack.persona, packVersion: pack.version } })
    await db.profile.upsert({
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
    await db.botLine.upsert({ where: { botId_key: { botId: bot.id, key: line.key } }, create: { botId: bot.id, key: line.key, ...data }, update: data })
  }
  await db.botLine.updateMany({ where: { botId: bot.id, key: { notIn: pack.lines.map((l) => l.key) } }, data: { enabled: false } })
  return { botId: bot.id, userId: bot.userId, pack }
}

export async function seedPacks(packs: Pack[]) {
  const seeded: SeededBot[] = []
  for (const pack of packs) seeded.push(await seedPack(pack))
  return seeded
}
