// Shared content of native block documents (doc/10 §10, minimal POC). Registry
// access decides (DocumentService.access): readers read, editors save. A save is
// optimistic — it names the version it was based on and gets 409 if someone saved
// since, so nothing is overwritten silently. Every save is one audited action
// (version only, never the text); the people-facing timeline is not involved.
// Maps and sheets keep device-local content until their own slices.
import { db, Prisma } from '@project/db'
import { badRequest, httpError } from '../lib/errors'
import { toAuthor } from '../lib/serialize'
import { runAction } from './actions'
import { DocumentService } from './DocumentService'
import { publish, setEditing } from './documentHub'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

const documents = new DocumentService()

const BLOCK_TYPES = new Set(['section', 'title', 'paragraph', 'media'])
const LEVELS = new Set(['body', 'h3', 'h2', 'h1'])
const KINDS = new Set(['image', 'video', 'audio', 'file'])

export type Block = {
  id: string
  type: 'section' | 'title' | 'paragraph' | 'media'
  level?: 'body' | 'h3' | 'h2' | 'h1'
  text?: string
  mediaName?: string
  mediaKind?: 'image' | 'video' | 'audio' | 'file'
}

const MAX_BLOCKS = 500
const MAX_TEXT = 20_000
const MAX_BYTES = 1_000_000

export function validateBlocks(content: unknown): Block[] {
  const fail = (why: string) => badRequest(why, 'INVALID_CONTENT')
  if (!Array.isArray(content) || content.length > MAX_BLOCKS) throw fail(`Content is a list of at most ${MAX_BLOCKS} blocks`)
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_BYTES) throw fail('Content is too large')
  const ids = new Set<string>()
  return content.map((raw) => {
    const b = raw as Record<string, unknown>
    if (!b || typeof b.id !== 'string' || !b.id || b.id.length > 64 || ids.has(b.id)) throw fail('Each block needs a unique id')
    ids.add(b.id)
    if (typeof b.type !== 'string' || !BLOCK_TYPES.has(b.type)) throw fail('Unknown block type')
    if (b.level !== undefined && (typeof b.level !== 'string' || !LEVELS.has(b.level))) throw fail('Invalid heading')
    if (b.text !== undefined && (typeof b.text !== 'string' || b.text.length > MAX_TEXT)) throw fail('Block text is too long')
    if (b.mediaName !== undefined && (typeof b.mediaName !== 'string' || b.mediaName.length > 255)) throw fail('Invalid media name')
    if (b.mediaKind !== undefined && (typeof b.mediaKind !== 'string' || !KINDS.has(b.mediaKind))) throw fail('Invalid media kind')
    const block: Block = { id: b.id, type: b.type as Block['type'] }
    if (b.level !== undefined) block.level = b.level as Block['level']
    if (b.text !== undefined) block.text = b.text as string
    if (b.mediaName !== undefined) block.mediaName = b.mediaName as string
    if (b.mediaKind !== undefined) block.mediaKind = b.mediaKind as Block['mediaKind']
    return block
  })
}

async function blocksDocument(userId: string, workspaceId: string, documentId: string, verb: 'document.read' | 'document.edit') {
  const access = await documents.access(userId, workspaceId, documentId, verb)
  if (access.row.surface !== 'blocks' || access.row.sourceKind !== 'native') {
    throw badRequest('Only block documents have shared content so far', 'NOT_SHARED_CONTENT')
  }
  return access
}

async function current(documentId: string) {
  const row = await db.documentContent.findUnique({ where: { documentId }, include: { updatedBy: { include: { user: { include: { profile: true } } } } } })
  return {
    version: row?.version ?? 0,
    content: (row?.content as Block[] | undefined) ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ? toAuthor(row.updatedBy.user) : null,
  }
}

export class DocumentContentService {
  async get(userId: string, workspaceId: string, documentId: string) {
    await blocksDocument(userId, workspaceId, documentId, 'document.read')
    return current(documentId)
  }

  /** Version (0 = no content yet) the cheap way, for stream catch-up. */
  async version(documentId: string) {
    return (await db.documentContent.findUnique({ where: { documentId }, select: { version: true } }))?.version ?? 0
  }

  async save(ctx: WorkspaceCtx, workspaceId: string, documentId: string, input: { expectedVersion: number; content: unknown }) {
    const { actor } = await blocksDocument(ctx.user.id, workspaceId, documentId, 'document.edit')
    const content = validateBlocks(input.content) as unknown as Prisma.InputJsonValue
    const conflict = () => httpError(409, 'The document changed; reload it and reapply your edit', 'DOCUMENT_CONTENT_CONFLICT')

    const version = await runAction(
      { action: 'document.content.save', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { expectedVersion: input.expectedVersion, blocks: (input.content as unknown[]).length }, target: { type: 'document', id: documentId } },
      async (tx) => {
        let next: number
        if (input.expectedVersion === 0) {
          // First save; a concurrent first save loses on the primary key.
          try {
            await tx.documentContent.create({ data: { documentId, workspaceId, version: 1, content, updatedByMemberId: actor.member.id } })
          } catch (error) {
            if ((error as { code?: string }).code === 'P2002') throw conflict()
            throw error
          }
          next = 1
        } else {
          const claimed = await tx.documentContent.updateMany({
            where: { documentId, version: input.expectedVersion },
            data: { version: { increment: 1 }, content, updatedByMemberId: actor.member.id },
          })
          if (!claimed.count) throw conflict()
          next = input.expectedVersion + 1
        }
        // The list orders by last change; the entry's own (metadata) version is untouched.
        await tx.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } })
        return { value: next, result: { version: next } }
      },
    )
    setEditing(documentId, actor.member.id, true)
    publish(documentId, { type: 'document.updated', version, memberId: actor.member.id, name: ctx.user.profile?.displayName ?? null })
    return current(documentId)
  }

  async presence(userId: string, workspaceId: string, documentId: string, editing: boolean) {
    const { actor } = await blocksDocument(userId, workspaceId, documentId, editing ? 'document.edit' : 'document.read')
    setEditing(documentId, actor.member.id, editing)
  }

  /** Who may open the stream, and what to call them in presence. */
  async streamAccess(userId: string, workspaceId: string, documentId: string) {
    const { actor } = await blocksDocument(userId, workspaceId, documentId, 'document.read')
    const member = await db.workspaceMember.findUniqueOrThrow({ where: { id: actor.member.id }, include: { user: { include: { profile: true } } } })
    return { memberId: actor.member.id, name: member.user.profile?.displayName ?? 'Someone' }
  }
}
