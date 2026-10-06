import { Prisma, type ImportKind } from '@project/db'
import { conflict, notFound } from '../lib/errors'

// Use the same lock order as chunk execution. State checks must happen inside
// the write transaction, after waiting for any commit/remap/cancel in flight.
export async function lockImport(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  id: string,
  kind: ImportKind,
) {
  await tx.$queryRaw`SELECT id FROM Workspace WHERE id = ${workspaceId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM ImportBatch WHERE id = ${id} AND workspaceId = ${workspaceId} FOR UPDATE`
  const batch = await tx.importBatch.findFirst({ where: { id, workspaceId, kind } })
  if (!batch) throw notFound('Import not found')
  return batch
}

export async function lockPreview(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  id: string,
  kind: ImportKind,
  expectedUpdatedAt?: Date,
) {
  const batch = await lockImport(tx, workspaceId, id, kind)
  if (batch.status !== 'previewed')
    throw conflict('Only a previewed import can change', 'IMPORT_NOT_PREVIEWED')
  if (batch.rowsPrunedAt) throw conflict('This import’s rows were pruned', 'IMPORT_PRUNED')
  if (expectedUpdatedAt && batch.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw conflict('This preview changed. Reload it before changing the mapping.', 'IMPORT_CHANGED')
  }
  return batch
}
