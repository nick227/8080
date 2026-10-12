// Usage: pnpm --filter server admin:bootstrap <registered-user-id>
// Deliberately creates only the first platform owner; never promotes by email/domain.
import { db } from '@project/db'
import { randomUUID } from 'crypto'

async function main() {
  const userId = process.argv[2]
  if (!userId || process.argv.length !== 3) throw new Error('Usage: admin:bootstrap <registered-user-id>')
  await db.$transaction(async tx => {
    await tx.adminMutationLock.upsert({ where: { id: 1 }, create: { id: 1 }, update: { version: { increment: 1 } } })
    if (await tx.platformStaff.count()) throw new Error('Platform staff already exists; bootstrap is disabled')
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user || user.deletedAt || user.suspendedAt || user.isGuest || user.kind !== 'human') throw new Error('Choose an active registered human account')
    await tx.platformStaff.create({ data: { userId, role: 'platform_owner', grantedById: 'bootstrap' } })
    await tx.user.update({ where: { id: userId }, data: { adminVersion: { increment: 1 } } })
    await tx.adminAuditEvent.create({ data: { actorId: 'bootstrap', targetUserId: userId, action: 'staff.bootstrap', reason: 'Initial platform owner created by operator CLI', requestId: randomUUID(), before: { role: null }, after: { role: 'platform_owner' } } })
  })
  console.log('Initial platform owner created and audited.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => db.$disconnect())
