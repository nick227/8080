import { db } from '@project/db'
import { afterEach } from 'vitest'

// Clean between tests — children before parents for FK constraints.
afterEach(async () => {
  await db.botDecision.deleteMany()
  await db.botOnce.deleteMany()
  await db.roomBot.deleteMany()
  await db.botLine.deleteMany()
  await db.botAsset.deleteMany()
  await db.bot.deleteMany()
  await db.userMute.deleteMany()
  await db.reaction.deleteMany()
  await db.media.deleteMany()
  await db.item.updateMany({ data: { parentId: null } }) // self-FK: unlink before delete
  await db.item.deleteMany()
  await db.message.deleteMany() // after items (FK) and media (SetNull)
  await db.roomMember.deleteMany()
  await db.room.deleteMany()
  await db.session.deleteMany()
  await db.profile.deleteMany()
  await db.user.deleteMany()
})
