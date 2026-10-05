// Workspace tags for contacts and accounts. Any member may create one (tagging is
// everyday work); renaming and deleting change everyone's records, so admins only.
import { db } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { toTag } from '../lib/serialize'
import { diff, runAction } from './actions'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'

const taken = (err: unknown) => (err as { code?: string })?.code === 'P2002'
const nameOf = (name: string) => {
  const trimmed = name.trim()
  if (!trimmed) throw badRequest('Name is required', 'INVALID_NAME')
  return trimmed
}

export class TagService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'record.read')
    const tags = await db.tag.findMany({ where: { workspaceId }, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
    return tags.map(toTag)
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: { name: string; color?: string | null }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'tag.create')
    const name = nameOf(input.name)
    try {
      return await runAction(
        { action: 'tag.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'tag' } },
        async (tx) => {
          const tag = await tx.tag.create({ data: { workspaceId, name, color: input.color ?? null } })
          return { value: toTag(tag), targetId: tag.id }
        },
      )
    } catch (err) {
      if (taken(err)) throw conflict('A tag with that name exists', 'TAG_NAME_TAKEN')
      throw err
    }
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, tagId: string, input: { name?: string; color?: string | null }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'tag.manage')
    const before = await db.tag.findFirst({ where: { id: tagId, workspaceId } })
    if (!before) throw notFound('Tag not found')
    const name = input.name === undefined ? undefined : nameOf(input.name)
    try {
      return await runAction(
        { action: 'tag.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'tag', id: tagId } },
        async (tx) => {
          const tag = await tx.tag.update({ where: { id: tagId }, data: { name, color: input.color } })
          return { value: toTag(tag), changes: diff(before, tag, ['name', 'color']) }
        },
      )
    } catch (err) {
      if (taken(err)) throw conflict('A tag with that name exists', 'TAG_NAME_TAKEN')
      throw err
    }
  }

  // Removes it from every record (the joins cascade).
  async remove(ctx: WorkspaceCtx, workspaceId: string, tagId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'tag.manage')
    const tag = await db.tag.findFirst({ where: { id: tagId, workspaceId } })
    if (!tag) throw notFound('Tag not found')
    await runAction(
      { action: 'tag.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'tag', id: tagId } },
      async (tx) => {
        await tx.tag.delete({ where: { id: tagId } })
        return { value: null, result: { name: tag.name } }
      },
    )
  }
}
