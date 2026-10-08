import { db } from '@project/db'
import { badRequest } from '../../lib/errors'
import { runAction } from '../actions'
import { authorize } from '../workspacePolicy'
import { memberActor, type WorkspaceCtx } from '../WorkspaceService'
import { produceBusinessEvent } from './businessTriggers'
import { suppressEmail } from './suppression'

export class BusinessEventService {
  async record(ctx: WorkspaceCtx, workspaceId: string, input: { contactId: string; kind: 'outreach_sent' | 'reply_received' | 'job_completed'; sourceKey: string; occurredAt: string; jobId?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    const occurredAt = new Date(input.occurredAt)
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 60000) throw badRequest('Choose a valid event time that is not in the future', 'INVALID_EVENT_TIME')
    if (!['outreach_sent', 'reply_received', 'job_completed'].includes(input.kind)) throw badRequest('Stage and customer events must come from contact changes', 'INVALID_BUSINESS_EVENT')
    if (input.kind === 'job_completed' && !input.jobId?.trim()) throw badRequest('A job reference is required', 'JOB_REQUIRED')
    return runAction({ action: 'agent.businessEvent', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'contact', id: input.contactId }, idempotencyKey: `business:${input.sourceKey}` }, async tx => {
      // A job can complete only once even if an integration retries with a different request key.
      const sourceKey = input.kind === 'job_completed' ? `job:${input.jobId}:completed` : `external:${input.sourceKey}`
      const signal = await produceBusinessEvent(tx, workspaceId, { contactId: input.contactId, kind: input.kind, sourceKey, occurredAt, facts: input.jobId ? { jobId: input.jobId } : {} })
      if (input.kind === 'outreach_sent') await tx.contact.updateMany({ where: { id: input.contactId, workspaceId, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: occurredAt } }] }, data: { lastContactedAt: occurredAt, contacted: true, version: { increment: 1 } } })
      const value = { id: signal.id, kind: signal.kind, contactId: signal.contactId, occurredAt: signal.occurredAt.toISOString() }
      return { value, result: { response: value }, activities: [{ type: `contact.${input.kind}`, occurredAt, subjects: [{ contactId: input.contactId }], summary: { businessEventId: signal.id, jobId: input.jobId ?? null } }] }
    }, async prior => (prior.result as { response: { id: string; kind: string; contactId: string; occurredAt: string } }).response)
  }
  async suppress(ctx: WorkspaceCtx, workspaceId: string, input: { address: string; reason: 'manual' | 'bounce' | 'complaint' }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    if (!['manual', 'bounce', 'complaint'].includes(input.reason)) throw badRequest('Invalid suppression reason')
    return runAction({ action: 'agent.suppressEmail', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'emailSuppression' } }, async tx => ({ value: await suppressEmail(tx, workspaceId, input.address, input.reason) }))
  }
  async suppressions(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'agent.manage')
    return db.agentEmailSuppression.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 500 })
  }
}
