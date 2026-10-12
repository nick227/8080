import { db, type Prisma } from '@project/db'
import { badRequest, conflict, httpError, notFound } from '../../lib/errors'
import { activeIdentity } from '../authorization/identity'
import { authorizePlatform } from '../authorization/platform'
import { entitlements } from '../admin/entitlements'
import { RoomService } from '../RoomService'

const rooms = new RoomService()
const openStates = ['reserved', 'dispatched', 'unknown']
const MAX_MICROS = 9_000_000_000_000_000n
const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
const validMoney = (amount: bigint, positive = false) => typeof amount === 'bigint' && amount >= (positive ? 1n : 0n) && amount <= MAX_MICROS
async function lock(tx: Prisma.TransactionClient) {
  // A native write takes the shared lock before any repeatable-read snapshot.
  await tx.$executeRaw`INSERT INTO LiveCostPolicy (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id`
  return tx.liveCostPolicy.findUniqueOrThrow({ where: { id: 1 } })
}
async function exposure(tx: Prisma.TransactionClient, periodStart: Date, userId?: string) {
  // Unresolved liabilities survive day rollover. Final costs belong to their
  // original reservation period; provider corrections must not disappear.
  const where = userId ? { userId } : {}
  const [held, spent, concurrent] = await Promise.all([
    tx.liveCostReservation.aggregate({ where: { ...where, status: { in: openStates } }, _sum: { reservedMicros: true } }),
    tx.liveCostReservation.aggregate({ where: { ...where, status: 'settled', periodStart }, _sum: { actualMicros: true } }),
    tx.liveCostReservation.count({ where: { ...where, status: { in: openStates } } }),
  ])
  return { micros: (held._sum.reservedMicros ?? 0n) + (spent._sum.actualMicros ?? 0n), concurrent }
}

/** Internal only. The future admission adapter must supply a bounded, versioned
 * provider quote, then enforce deadline/provider removal. This does NOT mint a
 * token, enable Live, or accept a price estimate from a browser. */
export async function reserveLiveCost(input: { requestKey: string; userId: string; roomId: string; reservedMicros: bigint; deadline: Date }) {
  if (!input.requestKey || input.requestKey.length > 191 || !validMoney(input.reservedMicros, true) || !Number.isFinite(input.deadline.getTime())) throw badRequest('Invalid Live cost reservation')
  await activeIdentity(input.userId)
  await rooms.viewable(input.userId, input.roomId)
  return db.$transaction(async tx => {
    const policy = await lock(tx)
    const now = new Date(), periodStart = dayStart(now)
    const prior = await tx.liveCostReservation.findUnique({ where: { requestKey: input.requestKey } })
    if (prior) {
      if (prior.userId !== input.userId || prior.roomId !== input.roomId || prior.reservedMicros !== input.reservedMicros || prior.deadline.getTime() !== input.deadline.getTime()) throw conflict('Reservation key was used for another request')
      // A retry is a lookup, never another provider dispatch authorization.
      return prior
    }
    await activeIdentity(input.userId, tx)
    if ((await entitlements(input.userId, tx)).tier !== 'premium') throw httpError(403, 'Premium is required for Live', 'PREMIUM_REQUIRED')
    if (policy.stopped) throw httpError(503, 'Live spending is stopped', 'LIVE_SPENDING_STOPPED')
    if (input.deadline <= now || input.deadline.getTime() > periodStart.getTime() + 86400000) throw badRequest('Reservation must end within the current UTC budget day')
    const [personal, platform] = await Promise.all([exposure(tx, periodStart, input.userId), exposure(tx, periodStart)])
    if (personal.micros + input.reservedMicros > policy.userDailyMicros || platform.micros + input.reservedMicros > policy.platformDailyMicros) throw httpError(429, 'Live spending allowance exhausted', 'LIVE_BUDGET_EXHAUSTED')
    if (personal.concurrent >= policy.userConcurrency || platform.concurrent >= policy.platformConcurrency) throw httpError(429, 'Live concurrency allowance exhausted', 'LIVE_CONCURRENCY_EXHAUSTED')
    return tx.liveCostReservation.create({ data: { ...input, status: 'reserved', periodStart } })
  })
}

/** Exactly one caller may transition to dispatched. Commit this marker BEFORE
 * any provider call; failures after this point must retain the liability. */
export async function dispatchLiveCost(id: string) {
  return db.$transaction(async tx => {
    const policy = await lock(tx)
    const row = await tx.liveCostReservation.findUnique({ where: { id } })
    if (!row) throw notFound('Reservation not found')
    if (policy.stopped) throw httpError(503, 'Live spending is stopped', 'LIVE_SPENDING_STOPPED')
    if (row.status !== 'reserved' || row.deadline <= new Date()) throw conflict('Reservation is not available for dispatch')
    await activeIdentity(row.userId, tx)
    if ((await entitlements(row.userId, tx)).tier !== 'premium') throw httpError(403, 'Premium is required for Live', 'PREMIUM_REQUIRED')
    return tx.liveCostReservation.update({ where: { id }, data: { status: 'dispatched', dispatchedAt: new Date() } })
  })
}
/** Only an undispatched reservation can be released without provider evidence. */
export async function releaseLiveCost(id: string) {
  return db.$transaction(async tx => {
    await lock(tx)
    const row = await tx.liveCostReservation.findUnique({ where: { id } })
    if (!row) throw notFound('Reservation not found')
    if (row.status === 'released') return row
    if (row.status !== 'reserved' || row.dispatchedAt) throw conflict('Dispatched or unknown costs require settlement evidence')
    return tx.liveCostReservation.update({ where: { id }, data: { status: 'released' } })
  })
}
/** Timeout is uncertainty, not proof of zero cost. Holds and concurrency survive. */
export async function markUnknownLiveCosts() {
  return db.$transaction(async tx => {
    await lock(tx)
    return tx.liveCostReservation.updateMany({ where: { status: { in: ['reserved','dispatched'] }, deadline: { lte: new Date() } }, data: { status: 'unknown' } })
  })
}
/** Internal verified-provider adapter only; no HTTP route accepts these figures.
 * Store the full measured cost even when it exceeds the reservation or ceiling. */
export async function settleLiveCost(id: string, actualMicros: bigint, evidenceId: string) {
  if (!validMoney(actualMicros) || !evidenceId || evidenceId.length > 191) throw badRequest('Invalid settlement evidence')
  return db.$transaction(async tx => {
    const policy = await lock(tx)
    const row = await tx.liveCostReservation.findUnique({ where: { id } })
    if (!row) throw notFound('Reservation not found')
    if (row.status === 'settled') {
      if (row.actualMicros === actualMicros && row.evidenceId === evidenceId) return row
      throw conflict('Settlement already recorded with different evidence')
    }
    if (!['dispatched','unknown'].includes(row.status)) throw conflict('Only dispatched or unknown costs can be settled')
    if (await tx.liveCostReservation.findUnique({ where: { evidenceId } })) throw conflict('Settlement evidence was already used')
    const result = await tx.liveCostReservation.update({ where: { id }, data: { status: 'settled', actualMicros, evidenceId, settledAt: new Date() } })
    const [personal, platform] = await Promise.all([exposure(tx, row.periodStart, row.userId), exposure(tx, row.periodStart)])
    if (actualMicros > row.reservedMicros || personal.micros > policy.userDailyMicros || platform.micros > policy.platformDailyMicros) {
      await tx.liveCostPolicy.update({ where: { id: 1 }, data: { stopped: true, version: { increment: 1 }, stopReason: 'Verified Live costs exceeded the reservation or budget' } })
    }
    await tx.adminAuditEvent.create({ data: { actorId: 'livekit-reconciliation', targetUserId: row.userId, action: 'live.cost.settled', reason: 'Verified provider cost recorded', requestId: `live-settle:${row.id}`, before: { status: row.status, reservedMicros: row.reservedMicros.toString() }, after: { actualMicros: actualMicros.toString(), evidenceId } } })
    return result
  })
}
export async function liveCostStatus(actorId: string) {
  await authorizePlatform(actorId, 'billing.read')
  const policy = await db.liveCostPolicy.findUnique({ where: { id: 1 } })
  return { stopped: policy?.stopped ?? true, version: policy?.version ?? 0, reason: policy?.stopReason ?? 'Live limits have not been configured',
    userDailyMicros: (policy?.userDailyMicros ?? 0n).toString(), platformDailyMicros: (policy?.platformDailyMicros ?? 0n).toString(),
    userConcurrency: policy?.userConcurrency ?? 0, platformConcurrency: policy?.platformConcurrency ?? 0,
    unknownReservations: await db.liveCostReservation.count({ where: { OR: [{ status: 'unknown' }, { status: { in: ['reserved','dispatched'] }, deadline: { lte: new Date() } }] } }),
  }
}
/** Admission stop only. Existing provider sessions require a removal worker;
 * this endpoint deliberately cannot resume Live or assert sessions have ended. */
export async function stopLiveSpending(actorId: string, input: { expectedVersion: number; reason: string; confirmed: boolean }, requestId: string) {
  await authorizePlatform(actorId, 'limits.manage')
  if (!input.confirmed || input.reason.trim().length < 3 || input.reason.trim().length > 500) throw badRequest('Confirm with a reason (3–500 characters)')
  await db.$transaction(async tx => {
    const policy = await lock(tx)
    await authorizePlatform(actorId, 'limits.manage', tx)
    if (policy.version !== input.expectedVersion) throw conflict('Live policy changed. Reload before confirming.', 'STALE_CONFIRMATION')
    await tx.liveCostPolicy.update({ where: { id: 1 }, data: { stopped: true, version: { increment: 1 }, stopReason: input.reason.trim() } })
    await tx.adminAuditEvent.create({ data: { actorId, targetUserId: 'platform', action: 'live.spending.stop', reason: input.reason.trim(), requestId, before: { stopped: policy.stopped, version: policy.version }, after: { stopped: true, version: policy.version + 1 } } })
  })
  return liveCostStatus(actorId)
}
