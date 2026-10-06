// Sheets made from records (doc/13 §12, A1).
import { sheetArtifacts } from '../services/SheetArtifactService'
import { workspaceCtx as ctx } from '../lib/session'

export async function listSheetPresets(r: any) {
  return { data: await sheetArtifacts.presets(r.user.id, r.params.workspaceId) }
}
export async function describeSheet(r: any) {
  return { data: { summary: await sheetArtifacts.describe(r.user.id, r.params.workspaceId, r.body.query) } }
}
export async function createSheet(r: any, reply: any) {
  const { preset, query, title, idempotencyKey } = r.body
  return reply.code(201).send({ data: await sheetArtifacts.create(ctx(r), r.params.workspaceId, { preset, query, title, idempotencyKey }) })
}
export async function getDocumentRecipe(r: any) {
  return { data: await sheetArtifacts.recipe(r.user.id, r.params.workspaceId, r.params.documentId) }
}
export async function regenerateDocument(r: any, reply: any) {
  return reply.code(201).send({ data: await sheetArtifacts.regenerate(ctx(r), r.params.workspaceId, r.params.documentId, r.body.idempotencyKey) })
}
