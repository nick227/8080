// Every workspace mutation runs through runAction (doc/09 §3): one ActionExecution
// row — the audit log and the idempotency record — written in the same transaction
// as the change, plus the Activity rows (people-facing timeline) it produces, which
// always point back at it. Rejections and failures are recorded too, outside the
// rolled-back transaction. There is no `agent` actor (doc/08 §4.9).
import { db, Prisma, type ActionExecution, type ActionOrigin } from '@project/db'
import { conflict } from '../lib/errors'
import { announceAction } from './inboxFanOut'
import { releaseInbox } from './inboxHub'

type Tx = Prisma.TransactionClient

// memberId may be unknown up front when the action creates the membership
// (create workspace, accept invite); the outcome supplies it.
export type ActionActor = { kind: 'member'; userId: string; memberId?: string } | { kind: 'system' } | { kind: 'integration' }

export type Changes = Record<string, [unknown, unknown]>

// A CRM record an activity is about (doc/09 §3 "subject"). Exactly one id.
export type SubjectRef = { contactId: string } | { accountId: string }
// What the activity refers to (at most one; itemId comes with its roomId).
export type ActivityObject = { noteId: string } | { roomId: string; itemId?: string | null }

export type ActivityDraft = {
  type: string
  summary: Record<string, unknown>
  occurredAt?: Date
  subjects?: SubjectRef[]
  object?: ActivityObject
}

export const subjectKey = (s: SubjectRef) => ('contactId' in s ? `contact:${s.contactId}` : `account:${s.accountId}`)

/** Adds subjects to existing activities (linking an object to a record, doc/09 Q-B). */
export async function addSubjects(tx: Tx, workspaceId: string, activities: { id: string; occurredAt: Date }[], subjects: SubjectRef[]) {
  const rows = activities.flatMap((a) => subjects.map((s) => ({ activityId: a.id, workspaceId, subjectKey: subjectKey(s), occurredAt: a.occurredAt, ...s })))
  if (rows.length) await tx.activitySubject.createMany({ data: rows, skipDuplicates: true })
  const newest = activities.reduce<Date | null>((max, a) => (!max || a.occurredAt > max ? a.occurredAt : max), null)
  if (newest) await touchSubjects(tx, subjects, newest)
}

// lastActivityAt only moves forward.
async function touchSubjects(tx: Tx, subjects: SubjectRef[], at: Date) {
  const contactIds = subjects.flatMap((s) => ('contactId' in s ? [s.contactId] : []))
  const accountIds = subjects.flatMap((s) => ('accountId' in s ? [s.accountId] : []))
  const stale = { OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: at } }] }
  if (contactIds.length) await tx.contact.updateMany({ where: { id: { in: contactIds }, ...stale }, data: { lastActivityAt: at } })
  if (accountIds.length) await tx.account.updateMany({ where: { id: { in: accountIds }, ...stale }, data: { lastActivityAt: at } })
}

export type ActionRequest = {
  action: string
  // Absent only when the action creates the workspace; the outcome supplies it.
  workspaceId?: string
  actor: ActionActor
  origin: ActionOrigin
  input: Record<string, unknown>
  target?: { type: string; id?: string }
  idempotencyKey?: string
}

export type ActionOutcome<T> = {
  value: T
  workspaceId?: string
  actorMemberId?: string
  targetId?: string
  changes?: Changes
  result?: Record<string, unknown>
  activities?: ActivityDraft[]
  notice?: { title: string; summary: string }
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue

/** Field-level diff of the listed fields; empty fields are left out. */
export function diff<T extends object>(before: T, after: T, fields: readonly (keyof T)[]): Changes {
  const changes: Changes = {}
  for (const field of fields) {
    const a = before[field] instanceof Date ? (before[field] as Date).toISOString() : before[field]
    const b = after[field] instanceof Date ? (after[field] as Date).toISOString() : after[field]
    if (a !== b) changes[field as string] = [a ?? null, b ?? null]
  }
  return changes
}

/**
 * Runs `perform` in a transaction and records it. With an idempotency key, a
 * repeat of a succeeded action returns `replay(previous)` instead of running
 * again; reusing a key for a different action or input is a 409.
 */
export async function runAction<T>(
  req: ActionRequest,
  perform: (tx: Tx) => Promise<ActionOutcome<T>>,
  replay?: (previous: ActionExecution) => Promise<T>,
): Promise<T> {
  if (req.idempotencyKey && req.workspaceId) {
    const previous = await priorExecution(req)
    if (previous) return replayed(req, previous, replay)
  }

  try {
    const { value, announced } = await db.$transaction(async (tx) => {
      const outcome = await perform(tx)
      const workspaceId = outcome.workspaceId ?? req.workspaceId
      if (!workspaceId) throw new Error(`${req.action}: no workspace to record against`)
      const actorMemberId = req.actor.kind === 'member' ? (outcome.actorMemberId ?? req.actor.memberId ?? null) : null
      const execution = await tx.actionExecution.create({
        data: {
          workspaceId,
          action: req.action,
          ...actorColumns(req.actor),
          actorMemberId,
          origin: req.origin,
          idempotencyKey: req.idempotencyKey ?? null,
          status: 'succeeded',
          targetType: req.target?.type ?? null,
          targetId: outcome.targetId ?? req.target?.id ?? null,
          input: json(req.input),
          changes: outcome.changes && Object.keys(outcome.changes).length ? json(outcome.changes) : Prisma.JsonNull,
          result: outcome.result ? json(outcome.result) : Prisma.JsonNull,
          finishedAt: new Date(),
        },
      })
      for (const activity of outcome.activities ?? []) {
        const created = await tx.activity.create({
          data: {
            workspaceId,
            type: activity.type,
            occurredAt: activity.occurredAt ?? execution.requestedAt,
            actorMemberId,
            actionExecutionId: execution.id,
            ...activity.object,
            summary: json(activity.summary),
          },
        })
        if (activity.subjects?.length) await addSubjects(tx, workspaceId, [created], activity.subjects)
      }
      const announced = await announceAction(tx, {
        workspaceId,
        action: req.action,
        executionId: execution.id,
        actorMemberId,
        targetType: req.target?.type ?? null,
        // The request id wins when the action names an existing row (a follow-up
        // points at the contact, not the compose row). A create supplies the id
        // only on the outcome.
        targetId: req.target?.id ?? outcome.targetId ?? null,
        notice: outcome.notice,
      })
      return { value: outcome.value, announced }
    })
    for (const item of announced) releaseInbox(item)
    return value
  } catch (err) {
    // A concurrent duplicate lost the race for the key: answer like a repeat.
    if (req.idempotencyKey && req.workspaceId && isKeyConflict(err)) {
      const previous = await priorExecution(req)
      if (previous) return replayed(req, previous, replay)
    }
    if (req.workspaceId) await recordFailure(req, err)
    throw err
  }
}

function actorColumns(actor: ActionActor) {
  return actor.kind === 'member' ? { actorKind: 'member' as const, actorUserId: actor.userId } : { actorKind: actor.kind, actorUserId: null }
}

function priorExecution(req: ActionRequest) {
  return db.actionExecution.findUnique({
    where: { workspaceId_idempotencyKey: { workspaceId: req.workspaceId!, idempotencyKey: req.idempotencyKey! } },
  })
}

async function replayed<T>(req: ActionRequest, previous: ActionExecution, replay?: (previous: ActionExecution) => Promise<T>) {
  const sameInput = JSON.stringify(previous.input) === JSON.stringify(json(req.input))
  if (previous.actorUserId !== (req.actor.kind === 'member' ? req.actor.userId : null) || previous.targetId !== (req.target?.id ?? previous.targetId) || previous.action !== req.action || !sameInput) {
    throw conflict('This idempotency key was already used for a different request', 'IDEMPOTENCY_KEY_REUSED')
  }
  if (!replay) throw conflict('This request was already processed', 'ALREADY_PROCESSED')
  return replay(previous)
}

function isKeyConflict(err: unknown) {
  const e = err as { code?: string; meta?: { target?: unknown } }
  return e?.code === 'P2002' && String(e.meta?.target ?? '').includes('idempotencyKey')
}

// Rejected = the request was refused (4xx); failed = something broke. The key is
// not stored, so the caller can retry with it; it's kept in `result` for tracing.
async function recordFailure(req: ActionRequest, err: unknown) {
  const e = err as { statusCode?: number; code?: unknown }
  const prismaConflict = e?.code === 'P2002'
  const rejected = prismaConflict || (typeof e?.statusCode === 'number' && e.statusCode < 500)
  try {
    await db.actionExecution.create({
      data: {
        workspaceId: req.workspaceId!,
        action: req.action,
        ...actorColumns(req.actor),
        actorMemberId: req.actor.kind === 'member' ? (req.actor.memberId ?? null) : null,
        origin: req.origin,
        status: rejected ? 'rejected' : 'failed',
        targetType: req.target?.type ?? null,
        targetId: req.target?.id ?? null,
        input: json(req.input),
        result: req.idempotencyKey ? json({ idempotencyKey: req.idempotencyKey }) : Prisma.JsonNull,
        errorCode: prismaConflict ? 'CONFLICT' : rejected ? (typeof e.code === 'string' ? e.code : 'REJECTED').slice(0, 60) : 'INTERNAL',
        finishedAt: new Date(),
      },
    })
  } catch {
    // Recording must never mask the original error.
  }
}
