// One source pointer on an inbox item or a follow-up (doc/11). Types with a
// table (contact, document, conversation, task) must exist in this workspace. system and calendar have no table yet:
// the id is the producer's, and an unknown type is refused.
import { db, Prisma } from '@project/db'
import { badRequest } from '../lib/errors'

type Client = Prisma.TransactionClient | typeof db

export type InboxAction =
  | { verb: 'open' }
  | { verb: 'compose'; contactId: string; channel: 'email' }

export async function assertSource(client: Client, workspaceId: string, sourceType: string, sourceId: string) {
  if (!sourceId || sourceId.length > 64) throw badRequest('Source is required', 'INVALID_SOURCE')
  if (sourceType === 'contact') {
    const row = await client.contact.findFirst({ where: { id: sourceId, workspaceId, deletedAt: null } })
    if (!row) throw badRequest('Unknown source', 'INVALID_SOURCE')
    return
  }
  if (sourceType === 'document') {
    const row = await client.document.findFirst({ where: { id: sourceId, workspaceId, deletedAt: null } })
    if (!row) throw badRequest('Unknown source', 'INVALID_SOURCE')
    return
  }
  if (sourceType === 'conversation') {
    const row = await client.room.findFirst({ where: { id: sourceId, deletedAt: null } })
    if (!row) throw badRequest('Unknown source', 'INVALID_SOURCE')
    return
  }
  if (sourceType === 'task') {
    const row = await client.workTask.findFirst({ where: { id: sourceId, workspaceId, deletedAt: null } })
    if (!row) throw badRequest('Unknown source', 'INVALID_SOURCE')
    return
  }
  if (sourceType === 'system' || sourceType === 'calendar') return
  throw badRequest(`Unknown source type "${sourceType}"`, 'UNKNOWN_SOURCE')
}

export function parseAction(value: unknown): InboxAction {
  if (!value || typeof value !== 'object') throw badRequest('Action is required', 'INVALID_ACTION')
  const action = value as { verb?: unknown; contactId?: unknown; channel?: unknown }
  if (action.verb === 'open') return { verb: 'open' }
  if (action.verb === 'compose' && typeof action.contactId === 'string' && action.channel === 'email') {
    return { verb: 'compose', contactId: action.contactId, channel: 'email' }
  }
  throw badRequest('Action must open the source, or compose email to a contact', 'INVALID_ACTION')
}
