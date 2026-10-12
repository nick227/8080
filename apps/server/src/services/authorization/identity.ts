import { db, type Prisma } from '@project/db'
import { httpError } from '../../lib/errors'

export async function activeIdentity(userId: string, client: Prisma.TransactionClient = db) {
  const user = await client.user.findUnique({ where: { id: userId } })
  if (!user || user.deletedAt) throw httpError(401, 'Sign in to continue', 'UNAUTHORIZED')
  if (user.suspendedAt) throw httpError(403, 'Account suspended', 'ACCOUNT_SUSPENDED')
  return user
}
