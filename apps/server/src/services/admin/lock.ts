import type { Prisma } from '@project/db'

// Must be the first statement in each admin transaction. Prisma's emulated
// upsert starts with a consistent SELECT, which can establish a stale MySQL
// REPEATABLE READ snapshot before waiting on the lock. One native write both
// creates/locks the row and leaves subsequent reads on a post-lock snapshot.
export async function lockAdminMutation(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`INSERT INTO AdminMutationLock (id, version) VALUES (1, 0) ON DUPLICATE KEY UPDATE version = version + 1`
}
