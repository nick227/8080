// A follow-up addressed to a contact (doc/11). The row records what was composed.
// It does not deliver mail and it does not start a thread. The action announces.
import { db } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { normalizePoint } from './contactMatch'
import { runAction } from './actions'
import { assertSource } from './inboxSource'
import { recordActivityEvent } from './activityEvent'
import { authorize } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

export type SendComposeInput = {
  contactId: string
  channel: string
  destination: string
  subject: string
  body: string
  contextType: string
  contextId: string
  idempotencyKey?: string
}

function serialize(row: { id: string; workspaceId: string; authorMemberId: string; contactId: string; channel: string; destination: string; subject: string; body: string; contextType: string; contextId: string; createdAt: Date }) {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

export class ComposeService {
  async send(ctx: WorkspaceCtx, workspaceId: string, input: SendComposeInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'compose.send')
    if (input.channel !== 'email') throw badRequest('Email is the only channel', 'CHANNEL_UNAVAILABLE')
    const destination = normalizePoint('email', input.destination)
    const subject = input.subject.trim()
    if (!subject || subject.length > 200) throw badRequest('Subject is required', 'EMPTY_SUBJECT')
    const body = input.body.trim()
    if (!body) throw badRequest('Body is required', 'EMPTY_BODY')
    await assertSource(db, workspaceId, input.contextType, input.contextId)
    const contact = await db.contact.findFirst({ where: { id: input.contactId, workspaceId, deletedAt: null } })
    if (!contact) throw badRequest('Unknown contact', 'INVALID_CONTACT')

    const stored = { contactId: input.contactId, channel: 'email' as const, destination, subject, body, contextType: input.contextType, contextId: input.contextId }
    return runAction(
      { action: 'compose.send', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: stored, idempotencyKey: input.idempotencyKey, target: { type: 'contact', id: input.contactId } },
      async (tx) => {
        const created = await tx.compose.create({
          data: { workspaceId, authorMemberId: actor.member.id, ...stored },
        })
        return {
          value: serialize(created),
          result: { id: created.id },
          activities: [{ type: 'compose.recorded', summary: { channel: 'email', destination, subject, composeId: created.id }, subjects: [{ contactId: input.contactId }] }],
        }
      },
      async (previous) => {
        const id = previous.result && typeof previous.result === 'object' && 'id' in previous.result ? String(previous.result.id) : ''
        const row = id ? await db.compose.findFirst({ where: { id, workspaceId } }) : null
        if (!row) throw notFound('Follow-up not found')
        return serialize(row)
      },
    ).then(async (created) => {
      try {
        await recordActivityEvent({
          workspaceId,
          type: 'compose.follow_up',
          title: `Follow-up: ${created.subject}`,
          summary: created.destination,
          sourceType: 'contact',
          sourceId: created.contactId,
          dedupeKey: `compose:${created.id}`,
          actorMemberId: created.authorMemberId,
          links: [
            { type: 'contact', id: created.contactId, workspaceId, title: 'View contact' },
            { type: 'compose', id: created.contactId, workspaceId, title: 'Message again' },
          ],
        })
      } catch (err: unknown) {
        console.error('activity event failed', err)
      }
      return created
    })
  }
}
