// "Import as contacts" (doc/10 §7A): the explicit canonical import, from pasted CSV
// or an imported sheet. Ordinary spreadsheet import is importDocumentCsv.
import { workspaceCtx as ctx } from '../lib/session'
import { ContactImportService } from '../services/ContactImportService'

const imports = new ContactImportService()

export async function listContactImports(request: any, reply: any) {
  return reply.send({ data: await imports.list(request.user.id, request.params.workspaceId) })
}

export async function createContactImport(request: any, reply: any) {
  return reply.status(201).send({ data: await imports.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function getContactImport(request: any, reply: any) {
  return reply.send({ data: await imports.get(request.user.id, request.params.workspaceId, request.params.importId) })
}

export async function updateContactImport(request: any, reply: any) {
  const { workspaceId, importId } = request.params
  return reply.send({ data: await imports.update(ctx(request), workspaceId, importId, request.body) })
}

export async function cancelContactImport(request: any, reply: any) {
  return reply.send({ data: await imports.cancel(ctx(request), request.params.workspaceId, request.params.importId) })
}

export async function listContactImportRows(request: any, reply: any) {
  return reply.send(await imports.rows(request.user.id, request.params.workspaceId, request.params.importId, request.query))
}

export async function resolveContactImportRow(request: any, reply: any) {
  const { workspaceId, importId, rowId } = request.params
  return reply.send({ data: await imports.resolve(ctx(request), workspaceId, importId, rowId, request.body) })
}

export async function commitContactImport(request: any, reply: any) {
  const { workspaceId, importId } = request.params
  return reply.send({ data: await imports.commit(ctx(request), workspaceId, importId, request.body ?? {}) })
}
