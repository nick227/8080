import type { ContactsQuery, DatasetWrite, DocumentDescriptor, GridTable } from '@project/shared'
import { Prisma } from '@project/db'
import { badRequest } from '../lib/errors'
import { authorize, permit } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { ContactService } from './ContactService'
import { DocumentService } from './DocumentService'
import { contactsDataset, validateContactsQuery } from './contactDataset'
import { renderCsv } from './documentCsv'
import { runAction } from './actions'
const contacts = new ContactService()
const documents = new DocumentService()

export class DocumentDatasetService {
  async catalog(userId: string, workspaceId: string) {
    const actor = await authorize(userId, workspaceId, 'dataset.read')
    permit(actor, 'record.read')
    return [{ ...contactsDataset, columns: contactsDataset.columns.map(c => ({ ...c, writable: c.writable && !!actor })) }]
  }
  async source(userId: string, workspaceId: string, documentId: string, write = false) {
    const { row } = await documents.access(userId, workspaceId, documentId, write ? 'document.edit' : 'document.read')
    const d = row.descriptor as unknown as DocumentDescriptor
    if (d.source.kind !== 'dataset') throw badRequest('Document is not a dataset view', 'NOT_DATASET_DOCUMENT')
    return d.source.query
  }
  query(userId: string, workspaceId: string, input: { query: ContactsQuery; cursor?: string; limit?: number }) {
    return contacts.queryDataset(userId, workspaceId, input.query, input)
  }
  async write(ctx: WorkspaceCtx, workspaceId: string, contactId: string, input: DatasetWrite) {
    const keys = Object.keys(input.changes)
    if (!keys.length || keys.some(k => !['firstName', 'lastName', 'displayName', 'title'].includes(k))) throw badRequest('Only contact name and title fields are writable', 'READ_ONLY_COLUMN')
    return contacts.update(ctx, workspaceId, contactId, { ...input.changes, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey })
  }
  async export(userId: string, workspaceId: string, query: ContactsQuery) {
    const result = await contacts.queryDataset(userId, workspaceId, query, { materialize: true })
    return { csv: renderCsv(query.columns, result.data.map(r => query.columns.map(c => r.cells[c] as string | null))), manifest: result.manifest }
  }
  async review(ctx: WorkspaceCtx, workspaceId: string, input: { title: string; query: ContactsQuery; idempotencyKey: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'document.create')
    permit(actor, 'dataset.export'); permit(actor, 'record.read')
    validateContactsQuery(input.query)
    const title = input.title.trim()
    if (!title || title.length > 200) throw badRequest('Title must contain 1–200 characters')
    const documentId = await runAction({ action: 'document.review.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document' }, input: { title, query: input.query }, idempotencyKey: input.idempotencyKey }, async tx => {
      const result = await contacts.queryDataset(ctx.user.id, workspaceId, input.query, { materialize: true })
      const table: GridTable = { columns: input.query.columns.map(id => ({ id, label: id, type: 'text' })), rows: result.data.map(r => ({ id: r.id, cells: r.cells as Record<string, string | null> })) }
      const row = await tx.document.create({ data: { workspaceId, ownerMemberId: actor.member.id, title, surface: 'grid', sourceKind: 'native', descriptor: { surface: 'grid', source: { kind: 'native', schemaVersion: 1 } }, payload: table as unknown as Prisma.InputJsonValue, provenance: { kind: 'review_copy', ...result.manifest } as unknown as Prisma.InputJsonValue, protectedDataset: 'contacts' } })
      return { value: row.id, targetId: row.id }
    }, async previous => previous.targetId!)
    return documents.get(ctx.user.id, workspaceId, documentId)
  }
}
