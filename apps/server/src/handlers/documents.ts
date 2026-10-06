import { workspaceCtx } from '../lib/session'
import { DocumentService } from '../services/DocumentService'
import { DocumentDatasetService } from '../services/DocumentDatasetService'
import { DocumentContentService } from '../services/DocumentContentService'
import { subscribe as subscribeDocument, type DocumentEvent } from '../services/documentHub'
const documents = new DocumentService()
const datasets = new DocumentDatasetService()
export async function listDocuments(r: any) { return documents.list(r.user.id, r.params.workspaceId, r.query) }
export async function createDocument(r: any, reply: any) { return reply.code(201).send({ data: await documents.create(workspaceCtx(r), r.params.workspaceId, r.body) }) }
export async function getDocument(r: any) { return { data: await documents.get(r.user.id, r.params.workspaceId, r.params.documentId) } }
export async function updateDocument(r: any) { return { data: await documents.patch(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.body) } }
export async function deleteDocument(r: any) { return { data: await documents.deletion(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.body?.expectedVersion, false) } }
export async function restoreDocument(r: any) { return { data: await documents.deletion(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.body.expectedVersion, true) } }
export async function listDocumentGrants(r: any) { return { data: await documents.grants(r.user.id, r.params.workspaceId, r.params.documentId) } }
export async function setDocumentGrant(r: any) { return { data: await documents.grant(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.params.memberId, r.body.role) } }
export async function setDocumentWorkspaceAccess(r: any) { return { data: await documents.setWorkspaceAccess(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.body.role) } }
export async function removeDocumentGrant(r: any) { return { data: await documents.grant(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.params.memberId, null) } }
export async function listDocumentRooms(r: any) { return { data: await documents.roomLinks(r.user.id, r.params.workspaceId, r.params.documentId) } }
export async function linkDocumentRoom(r: any) { return { data: await documents.roomLink(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.params.roomId, false) } }
export async function unlinkDocumentRoom(r: any) { return { data: await documents.roomLink(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.params.roomId, true) } }
export async function listRelatedDocuments(r: any) { return { data: await documents.related(r.user.id, r.params.workspaceId, r.params.documentId) } }
export async function relateDocuments(r: any) { return { data: await documents.relation(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.params.relatedDocumentId, false) } }
export async function unrelateDocuments(r: any) { return { data: await documents.relation(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.params.relatedDocumentId, true) } }
export async function getDocumentMaterialization(r: any) { return { data: await documents.materialization(r.user.id, r.params.workspaceId, r.params.documentId) } }
export async function importDocumentCsv(r: any, reply: any) { return reply.code(201).send({ data: await documents.importCsv(workspaceCtx(r), r.params.workspaceId, r.body) }) }
export async function listDocumentDatasets(r: any) { return { data: await datasets.catalog(r.user.id, r.params.workspaceId) } }
export async function queryContactsDataset(r: any) { return datasets.query(r.user.id, r.params.workspaceId, r.body) }
export async function updateContactsDatasetRow(r: any) { return { data: await datasets.write(workspaceCtx(r), r.params.workspaceId, r.params.contactId, r.body) } }
export async function exportContactsDataset(r: any) { return { data: await datasets.export(r.user.id, r.params.workspaceId, r.body.query) } }
export async function createContactsReviewCopy(r: any, reply: any) { return reply.code(201).send({ data: await datasets.review(workspaceCtx(r), r.params.workspaceId, r.body) }) }
export async function queryDocumentDataset(r: any) { const query = await datasets.source(r.user.id, r.params.workspaceId, r.params.documentId); return datasets.query(r.user.id, r.params.workspaceId, { ...r.body, query }) }
export async function updateDocumentDatasetRow(r: any) {
  await datasets.source(r.user.id, r.params.workspaceId, r.params.documentId, true)
  return { data: await datasets.write(workspaceCtx(r), r.params.workspaceId, r.params.contactId, r.body) }
}

// ─── shared native content (block documents, doc/10 §10 POC) ─────────────────
const contents = new DocumentContentService()

export async function getDocumentContent(r: any) { return { data: await contents.get(r.user.id, r.params.workspaceId, r.params.documentId) } }
export async function saveDocumentContent(r: any) { return { data: await contents.save(workspaceCtx(r), r.params.workspaceId, r.params.documentId, r.body) } }
export async function setDocumentPresence(r: any) {
  await contents.presence(r.user.id, r.params.workspaceId, r.params.documentId, r.body.editing)
  return { data: null }
}

// SSE: `document.updated` (a new version — fetch the content) and `document.presence`
// (who has it open, who is editing). Pushed live by this process, and backed by a
// version check every 2 s, so a restart or another instance only adds a short delay.
export async function streamDocumentEvents(request: any, reply: any) {
  const { workspaceId, documentId } = request.params
  const me = await contents.streamAccess(request.user.id, workspaceId, documentId)
  reply.hijack()
  reply.raw.writeHead(200, {
    ...reply.getHeaders(), 'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
  })
  reply.raw.write('retry: 2000\n\n')
  let closed = false
  let lastVersion = await contents.version(documentId)
  const write = (frame: string) => {
    if (closed) return
    if (!reply.raw.write(frame)) request.raw.destroy()
  }
  const send = (event: DocumentEvent) => {
    if (event.type === 'document.updated') {
      if (event.version <= lastVersion) return
      lastVersion = event.version
    }
    write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  const unsubscribe = subscribeDocument(documentId, { memberId: me.memberId, name: me.name, send })
  const heartbeat = setInterval(() => write(': ping\n\n'), 25_000)
  const check = setInterval(async () => {
    try {
      await contents.streamAccess(request.user.id, workspaceId, documentId) // access lost → stream ends
      const version = await contents.version(documentId)
      if (version > lastVersion) send({ type: 'document.updated', version, memberId: null, name: null })
    } catch {
      request.raw.destroy()
    }
  }, 2000)
  request.raw.on('close', () => {
    closed = true
    clearInterval(heartbeat)
    clearInterval(check)
    unsubscribe()
  })
}
