import { createHash } from 'crypto'
import { db, Prisma } from '@project/db'
import type { DocumentCreate, DocumentDescriptor, DocumentPatch, GridTable } from '@project/shared'
import { badRequest, conflict, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit } from '../lib/pagination'
import { authorize, can, documentVisibility, permit, type Actor } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { runAction } from './actions'
import { RoomService } from './RoomService'
import { visibleRoomIds } from './records'
import { validateContactsQuery } from './contactDataset'
import { parseDocumentCsv } from './documentCsv'

const include = { grants: true } satisfies Prisma.DocumentInclude
type Row = Prisma.DocumentGetPayload<{ include: typeof include }>
const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue
const target = (row: Row) => ({ kind: 'document' as const, ownerMemberId: row.ownerMemberId, grants: row.grants, workspaceAccess: row.workspaceAccess })
const rooms = new RoomService()

export function normalizeDescriptor(d: DocumentDescriptor): DocumentDescriptor {
  if (d.source.kind === 'native' && ['blocks', 'mental_map', 'grid'].includes(d.surface) && d.source.schemaVersion === 1) return d
  if (d.surface === 'grid' && d.source.kind === 'dataset' && d.source.datasetKey === 'contacts' && d.source.datasetVersion === 1) { validateContactsQuery(d.source.query); return d }
  if (d.surface === 'external' && d.source.kind === 'external') {
    let url: URL
    try { url = new URL(d.source.url) } catch { throw badRequest('Invalid Google document URL', 'INVALID_DOCUMENT_URL') }
    const path = d.source.provider === 'google_docs' ? 'document' : d.source.provider === 'google_sheets' ? 'spreadsheets' : ''
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password || !path || !new RegExp(`^/${path}/(?:u/\\d+/)?d/[A-Za-z0-9_-]+(?:/(?:edit|view|preview|copy))?/?$`).test(url.pathname)) throw badRequest('Use a Google Doc or Sheet file URL matching its provider', 'INVALID_DOCUMENT_URL')
    return { surface: 'external', source: { ...d.source, url: url.toString() } }
  }
  throw badRequest('Unsupported document surface/source combination', 'INVALID_DOCUMENT_DESCRIPTOR')
}
// The provider's file id ("/d/<id>/"), used only to warn about duplicate links.
export function externalFileId(d: DocumentDescriptor): string | null {
  if (d.source.kind !== 'external') return null
  return new URL(d.source.url).pathname.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? null
}
function title(value: string) {
  const result = value.trim()
  if (!result || result.length > 200) throw badRequest('Title must contain 1–200 characters', 'INVALID_TITLE')
  return result
}
function serialize(row: Row, actor: Actor) {
  const descriptor = row.descriptor as unknown as DocumentDescriptor
  const edit = !row.deletedAt && can(actor.member, 'document.edit', target(row))
  const manage = can(actor.member, 'document.manage', target(row))
  return { id: row.id, workspaceId: row.workspaceId, ownerMemberId: row.ownerMemberId, title: row.title, version: row.version, descriptor,
    capabilities: { editMetadata: edit, manageAccess: manage, delete: manage && !row.deletedAt, restore: manage && !!row.deletedAt,
      // Editors and native realtime have not been implemented in this seam.
      editContent: false, showNativePresence: false, queryDataset: !row.deletedAt && row.sourceKind === 'dataset' && can(actor.member, 'dataset.read'),
      editRecords: edit && row.sourceKind === 'dataset' && can(actor.member, 'record.write'),
      openExternal: !row.deletedAt && row.sourceKind === 'external', readMaterialization: !row.deletedAt && row.payload !== null,
      exportData: !row.deletedAt && row.sourceKind === 'dataset' && can(actor.member, 'dataset.export') },
    externalFileId: row.externalFileId, workspaceAccess: row.workspaceAccess, provenance: row.provenance, createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt }
}
export class DocumentService {
  async access(userId: string, workspaceId: string, documentId: string, verb: 'document.read' | 'document.edit' | 'document.manage' = 'document.read', deleted = false) {
    const actor = await authorize(userId, workspaceId, 'workspace.read')
    const row = await db.document.findFirst({ where: { id: documentId, workspaceId, ...(deleted ? {} : { deletedAt: null }) }, include })
    if (!row || !can(actor.member, 'document.read', target(row))) throw notFound('Document not found')
    permit(actor, verb, target(row))
    if (row.sourceKind === 'dataset' || row.protectedDataset) { permit(actor, 'dataset.read'); permit(actor, 'record.read') }
    return { actor, row }
  }
  async get(userId: string, workspaceId: string, id: string) {
    const { row, actor } = await this.access(userId, workspaceId, id, 'document.read', true)
    return serialize(row, actor)
  }
  // Most recently changed first (doc/10 §3: "last activity known to our app").
  async list(userId: string, workspaceId: string, opts: { q?: string; surface?: DocumentDescriptor['surface']; deleted?: boolean; roomId?: string; externalFileId?: string; cursor?: string; limit?: number }) {
    const actor = await authorize(userId, workspaceId, 'workspace.read')
    if (opts.roomId) await rooms.viewable(userId, opts.roomId)
    const cursor = decodeKeyCursor<{ u: string; id: string }>(opts.cursor)
    const at = cursor ? new Date(cursor.u) : null
    if (cursor && (typeof cursor.id !== 'string' || !at || Number.isNaN(at.getTime()))) throw badRequest('Invalid cursor')
    const limit = normalizeLimit(opts.limit)
    const rows = await db.document.findMany({
      where: {
        workspaceId, deletedAt: opts.deleted ? { not: null } : null, ...documentVisibility(actor),
        ...(opts.q ? { title: { contains: opts.q } } : {}), ...(opts.surface ? { surface: opts.surface } : {}),
        ...(opts.roomId ? { rooms: { some: { roomId: opts.roomId } } } : {}), ...(opts.externalFileId ? { externalFileId: opts.externalFileId } : {}),
        ...(at ? { AND: [{ OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: cursor!.id } }] }] } : {}),
      },
      include, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    })
    const hasMore = rows.length > limit
    if (hasMore) rows.pop()
    const last = rows[rows.length - 1]
    return { data: rows.map(r => serialize(r, actor)), meta: { nextCursor: hasMore && last ? encodeKeyCursor({ u: last.updatedAt.toISOString(), id: last.id }) : null } }
  }
  // `extra` (server-internal): where a native document came from (e.g. the chatbot
  // workflow run and profile revision) and its workspace audience. A person's own
  // document starts private; a workspace workflow's starts shared (doc/12 §5.4), set
  // in the same action that creates it.
  async create(ctx: WorkspaceCtx, workspaceId: string, input: DocumentCreate, materialization?: { table: GridTable; provenance: object; protectedDataset?: 'contacts' }, extra: { provenance?: object; workspaceAccess?: 'viewer' | 'editor' } = {}) {
    const { provenance, workspaceAccess } = extra
    const actor = await authorize(ctx.user.id, workspaceId, 'document.create')
    const descriptor = normalizeDescriptor(input.descriptor)
    if (descriptor.source.kind === 'dataset' || materialization?.protectedDataset) { permit(actor, 'dataset.read'); permit(actor, 'record.read') }
    if (materialization && !(descriptor.surface === 'grid' && descriptor.source.kind === 'native')) throw badRequest('Materialization requires a native grid')
    const normalizedTitle = title(input.title)
    // Store a digest rather than raw contact values or pasted CSV in the audit input.
    const contentHash = materialization ? createHash('sha256').update(JSON.stringify(materialization)).digest('hex') : null
    return runAction({ action: 'document.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document' }, idempotencyKey: input.idempotencyKey,
      input: { title: normalizedTitle, descriptor, contentHash, workspaceAccess: workspaceAccess ?? null } }, async tx => {
      const row = await tx.document.create({ data: { workspaceId, ownerMemberId: actor.member.id, title: normalizedTitle, surface: descriptor.surface, sourceKind: descriptor.source.kind, descriptor: json(descriptor), externalFileId: externalFileId(descriptor), ...(materialization ? { payload: json(materialization.table), provenance: json(materialization.provenance), protectedDataset: materialization.protectedDataset } : provenance ? { provenance: json(provenance) } : {}), ...(workspaceAccess ? { workspaceAccess } : {}) }, include })
      return { value: serialize(row, actor), targetId: row.id }
    }, async previous => this.get(ctx.user.id, workspaceId, previous.targetId!))
  }
  async patch(ctx: WorkspaceCtx, workspaceId: string, id: string, input: DocumentPatch) {
    const { actor, row } = await this.access(ctx.user.id, workspaceId, id, 'document.edit')
    const descriptor = input.descriptor ? normalizeDescriptor(input.descriptor) : row.descriptor as unknown as DocumentDescriptor
    if (descriptor.surface !== row.surface || descriptor.source.kind !== row.sourceKind) throw badRequest('Changing source or surface requires a new document', 'DOCUMENT_SOURCE_IMMUTABLE')
    return runAction({ action: 'document.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document', id }, input }, async tx => {
      const result = await tx.document.updateMany({ where: { id, workspaceId, version: input.expectedVersion, deletedAt: null }, data: { title: input.title === undefined ? undefined : title(input.title), descriptor: json(descriptor), externalFileId: externalFileId(descriptor), version: { increment: 1 } } })
      if (!result.count) throw conflict('Document changed; reload before reapplying', 'DOCUMENT_VERSION_CONFLICT')
      return { value: serialize(await tx.document.findUniqueOrThrow({ where: { id }, include }), actor) }
    })
  }
  async deletion(ctx: WorkspaceCtx, workspaceId: string, id: string, expectedVersion: number, restore: boolean) {
    const { actor } = await this.access(ctx.user.id, workspaceId, id, 'document.manage', true)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('expectedVersion is required', 'INVALID_VERSION')
    return runAction({ action: restore ? 'document.restore' : 'document.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document', id }, input: { expectedVersion } }, async tx => {
      const result = await tx.document.updateMany({ where: { id, workspaceId, version: expectedVersion }, data: { deletedAt: restore ? null : new Date(), version: { increment: 1 } } })
      if (!result.count) throw conflict('Document changed', 'DOCUMENT_VERSION_CONFLICT')
      return { value: serialize(await tx.document.findUniqueOrThrow({ where: { id }, include }), actor) }
    })
  }
  async grants(userId: string, workspaceId: string, id: string) {
    const { row } = await this.access(userId, workspaceId, id, 'document.manage')
    return row.grants
  }
  async grant(ctx: WorkspaceCtx, workspaceId: string, id: string, memberId: string, role: 'viewer' | 'editor' | null) {
    const { actor, row } = await this.access(ctx.user.id, workspaceId, id, 'document.manage')
    if (memberId === row.ownerMemberId) throw badRequest('The owner has implicit management access', 'OWNER_GRANT')
    if (!await db.workspaceMember.findFirst({ where: { id: memberId, workspaceId, ...(role ? { status: 'active' } : {}) } })) throw notFound('Member not found')
    return runAction({ action: 'document.grant', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document', id }, input: { memberId, role } }, async tx => {
      if (role) await tx.documentGrant.upsert({ where: { documentId_memberId: { documentId: id, memberId } }, create: { workspaceId, documentId: id, memberId, role }, update: { role } })
      else await tx.documentGrant.deleteMany({ where: { documentId: id, memberId, workspaceId } })
      return { value: null }
    })
  }
  /** Who in the workspace sees it besides the owner and grants: null = private. */
  async setWorkspaceAccess(ctx: WorkspaceCtx, workspaceId: string, id: string, role: 'viewer' | 'editor' | null) {
    const { actor } = await this.access(ctx.user.id, workspaceId, id, 'document.manage')
    return runAction({ action: 'document.workspaceAccess', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document', id }, input: { role } }, async tx => {
      const row = await tx.document.update({ where: { id }, data: { workspaceAccess: role }, include })
      return { value: serialize(row, actor) }
    })
  }
  async roomLinks(userId: string, workspaceId: string, id: string) {
    await this.access(userId, workspaceId, id)
    const links = await db.documentRoomLink.findMany({ where: { workspaceId, documentId: id }, orderBy: { id: 'asc' }, take: 100 })
    const visible = await visibleRoomIds(userId, links.map(l => l.roomId))
    return links.filter(l => visible.has(l.roomId))
  }
  async roomLink(ctx: WorkspaceCtx, workspaceId: string, id: string, roomId: string, remove: boolean) {
    const { actor } = await this.access(ctx.user.id, workspaceId, id, 'document.edit')
    await rooms.viewable(ctx.user.id, roomId)
    return runAction({ action: remove ? 'document.room.unlink' : 'document.room.link', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document', id }, input: { roomId } }, async tx => {
      if (remove) await tx.documentRoomLink.deleteMany({ where: { workspaceId, documentId: id, roomId } })
      else await tx.documentRoomLink.upsert({ where: { documentId_roomId: { documentId: id, roomId } }, create: { workspaceId, documentId: id, roomId }, update: {} })
      return { value: null }
    })
  }
  async related(userId: string, workspaceId: string, id: string) {
    const { actor } = await this.access(userId, workspaceId, id)
    // Filter both endpoints in SQL before limiting or returning metadata.
    const visible = { workspaceId, deletedAt: null, ...documentVisibility(actor) }
    const relations = await db.documentRelation.findMany({ where: { workspaceId, OR: [{ fromId: id }, { toId: id }], from: visible, to: visible }, include: { from: { include }, to: { include } }, orderBy: { id: 'asc' }, take: 100 })
    return relations.map(r => ({ id: r.id, document: serialize(r.fromId === id ? r.to : r.from, actor), createdAt: r.createdAt }))
  }
  async relation(ctx: WorkspaceCtx, workspaceId: string, id: string, relatedId: string, remove: boolean) {
    const { actor } = await this.access(ctx.user.id, workspaceId, id, 'document.edit')
    await this.access(ctx.user.id, workspaceId, relatedId)
    if (id === relatedId) throw badRequest('Cannot relate a document to itself', 'SELF_RELATION')
    const [fromId, toId] = [id, relatedId].sort() as [string, string]
    return runAction({ action: remove ? 'document.relation.remove' : 'document.relation.add', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document', id }, input: { relatedId } }, async tx => {
      if (remove) await tx.documentRelation.deleteMany({ where: { workspaceId, fromId, toId } })
      else await tx.documentRelation.upsert({ where: { fromId_toId: { fromId, toId } }, create: { workspaceId, fromId, toId }, update: {} })
      return { value: null }
    })
  }
  async materialization(userId: string, workspaceId: string, id: string) {
    const { row } = await this.access(userId, workspaceId, id)
    if (!row.payload) throw notFound('Document has no materialized table')
    return { table: row.payload, provenance: row.provenance }
  }
  async importCsv(ctx: WorkspaceCtx, workspaceId: string, input: { title: string; csv: string; filename: string; idempotencyKey: string }) {
    const table = parseDocumentCsv(input.csv)
    return this.create(ctx, workspaceId, { title: input.title, idempotencyKey: input.idempotencyKey, descriptor: { surface: 'grid', source: { kind: 'native', schemaVersion: 1 } } }, { table, provenance: { kind: 'csv_import', filename: input.filename, parserVersion: 1, sourceHash: createHash('sha256').update(input.csv).digest('hex'), rowCount: table.rows.length } })
  }
}
