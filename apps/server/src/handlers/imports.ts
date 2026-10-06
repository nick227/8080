// Canonical record imports: contacts (doc/10 §7A) and inventory (doc/13 slice 4).
// Ordinary spreadsheet import is importDocumentCsv and never writes CRM rows.
import { workspaceCtx as ctx } from '../lib/session'
import { ContactImportService } from '../services/ContactImportService'
import { InventoryImportService } from '../services/InventoryImportService'

const contacts = new ContactImportService()
const inventory = new InventoryImportService()

export async function listContactImports(request: any, reply: any) {
  return reply.send({ data: await contacts.list(request.user.id, request.params.workspaceId) })
}

export async function createContactImport(request: any, reply: any) {
  return reply.status(201).send({ data: await contacts.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function getContactImport(request: any, reply: any) {
  return reply.send({ data: await contacts.get(request.user.id, request.params.workspaceId, request.params.importId) })
}

export async function updateContactImport(request: any, reply: any) {
  const { workspaceId, importId } = request.params
  return reply.send({ data: await contacts.update(ctx(request), workspaceId, importId, request.body) })
}

export async function cancelContactImport(request: any, reply: any) {
  return reply.send({ data: await contacts.cancel(ctx(request), request.params.workspaceId, request.params.importId) })
}

export async function listContactImportRows(request: any, reply: any) {
  return reply.send(await contacts.rows(request.user.id, request.params.workspaceId, request.params.importId, request.query))
}

export async function resolveContactImportRow(request: any, reply: any) {
  const { workspaceId, importId, rowId } = request.params
  return reply.send({ data: await contacts.resolve(ctx(request), workspaceId, importId, rowId, request.body) })
}

export async function commitContactImport(request: any, reply: any) {
  const { workspaceId, importId } = request.params
  return reply.send({ data: await contacts.commit(ctx(request), workspaceId, importId, request.body ?? {}) })
}

export async function listInventoryImports(request: any, reply: any) {
  return reply.send({ data: await inventory.list(request.user.id, request.params.workspaceId) })
}

export async function createInventoryImport(request: any, reply: any) {
  return reply.status(201).send({ data: await inventory.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function getInventoryImport(request: any, reply: any) {
  return reply.send({ data: await inventory.get(request.user.id, request.params.workspaceId, request.params.importId) })
}

export async function updateInventoryImport(request: any, reply: any) {
  const { workspaceId, importId } = request.params
  return reply.send({ data: await inventory.update(ctx(request), workspaceId, importId, request.body) })
}

export async function cancelInventoryImport(request: any, reply: any) {
  return reply.send({ data: await inventory.cancel(ctx(request), request.params.workspaceId, request.params.importId) })
}

export async function listInventoryImportRows(request: any, reply: any) {
  return reply.send(await inventory.rows(request.user.id, request.params.workspaceId, request.params.importId, request.query))
}

export async function resolveInventoryImportRow(request: any, reply: any) {
  const { workspaceId, importId, rowId } = request.params
  return reply.send({ data: await inventory.resolve(ctx(request), workspaceId, importId, rowId, request.body) })
}

export async function commitInventoryImport(request: any, reply: any) {
  const { workspaceId, importId } = request.params
  return reply.send({ data: await inventory.commit(ctx(request), workspaceId, importId) })
}
