// Dev-only bot tuning endpoints (doc/08 R25). Registered only with BOTS_DEV=1 and
// never in production; outside the OpenAPI contract on purpose. No auth — local
// tuning only.
//   GET  /dev/bots                                    packs, versions, workflows
//   POST /dev/bots/dry-run   { handle, roomId, text, pool? }   classify + score, posts nothing
//   POST /dev/bots/fire      { handle, workflow, roomId, userId?, itemId? }   run it for real
//   POST /dev/bots/seat      { handle, roomId, seated }        seat/kick bypassing the owner check
//   GET  /dev/bots/decisions?roomId=&limit=           newest decisions first
//   GET  /dev/bots/routes?roomId=&limit=              AI router (shadow) vs deterministic, newest first
//   POST /dev/bots/routes/:id/label  { agent, shouldRespond }   human ground truth
//   GET  /dev/bots/routes/stats?hours=24              disagreement, handoff precision, none FP/FN, warm p50/p95
import type { FastifyInstance } from 'fastify'
import { db } from '@project/db'
import { botRuntime } from '../bots/runtime'
import { events } from '../services/events'
import { streamHub } from '../services/StreamHub'

export default async function devBots(server: FastifyInstance) {
  const runtime = () => {
    const rt = botRuntime()
    if (!rt) throw { statusCode: 503, message: 'Bot runtime not started' }
    return rt
  }

  server.get('/dev/bots', async () => ({
    data: runtime().seeded.map((b) => ({
      handle: b.pack.handle, kind: b.pack.kind, userId: b.userId, version: b.pack.version,
      workflows: b.pack.workflows.map((w) => ({ id: w.id, on: w.on, key: w.key, once: w.once })),
      lines: b.pack.lines.length, assets: b.pack.assets.length,
    })),
  }))

  server.post('/dev/bots/dry-run', async (request: any) => {
    const { handle, roomId, text, pool } = request.body ?? {}
    return { data: await runtime().dryRun(String(handle), String(roomId), String(text ?? ''), pool) }
  })

  server.post('/dev/bots/fire', async (request: any) => {
    const { handle, workflow, roomId, userId, itemId } = request.body ?? {}
    await runtime().fire(String(handle), String(workflow), String(roomId), { userId, itemId })
    return { data: { started: true } }
  })

  server.post('/dev/bots/seat', async (request: any) => {
    const { handle, roomId, seated } = request.body ?? {}
    const bot = await db.bot.findUnique({ where: { handle: String(handle) } })
    if (!bot) throw { statusCode: 404, message: 'Unknown bot' }
    const state = seated === false ? 'kicked' : 'seated'
    await db.roomBot.upsert({ where: { roomId_botId: { roomId, botId: bot.id } }, create: { roomId, botId: bot.id, state }, update: { state } })
    events.emit('seating.changed', { roomId, botId: bot.id, seated: state === 'seated', byUserId: bot.userId })
    streamHub.publishParticipants(roomId)
    return { data: { handle, roomId, state } }
  })

  server.get('/dev/bots/decisions', async (request: any) => {
    const { roomId, limit } = request.query ?? {}
    const rows = await db.botDecision.findMany({
      where: roomId ? { roomId: String(roomId) } : {},
      orderBy: { at: 'desc' },
      take: Math.min(Number(limit) || 20, 200),
      include: { bot: { select: { handle: true } } },
    })
    return { data: rows.map(({ bot, ...d }) => ({ handle: bot.handle, ...d })) }
  })

  // Shadow-router review. Label a row with what *should* have happened, then read
  // the stats: disagreement on unmentioned messages, handoff precision, none
  // false positives/negatives, warm latency.
  server.get('/dev/bots/routes', async (request: any) => {
    const { roomId, limit, unlabeled, reason } = request.query ?? {}
    const rows = await db.botRoute.findMany({
      where: { ...(roomId ? { roomId: String(roomId) } : {}), ...(unlabeled ? { labeledAt: null, error: null } : {}), ...(reason ? { reason: String(reason) } : {}) },
      orderBy: { at: 'desc' },
      take: Math.min(Number(limit) || 20, 200),
    })
    return { data: rows.map((r) => ({ id: r.id, at: r.at, reason: r.reason, text: (r.input as any)?.message?.text, bots: (r.input as any)?.bots?.map((b: any) => b.handle), deterministic: r.deterministic, ai: r.ai, agree: r.agree, label: r.label, error: r.error, latencyMs: r.latencyMs, cold: r.cold })) }
  })

  // { agent: handle | null, shouldRespond: boolean } — the right answer for this message.
  server.post('/dev/bots/routes/:id/label', async (request: any) => {
    const { agent, shouldRespond } = request.body ?? {}
    if (typeof shouldRespond !== 'boolean' || (agent !== null && typeof agent !== 'string')) throw { statusCode: 400, message: 'Body: { agent: string | null, shouldRespond: boolean }' }
    const row = await db.botRoute.update({ where: { id: request.params.id }, data: { label: { agent, shouldRespond }, labeledAt: new Date() } })
    return { data: { id: row.id, label: row.label } }
  })

  server.get('/dev/bots/routes/stats', async (request: any) => {
    const hours = Math.min(Number(request.query?.hours) || 24, 24 * 7)
    const rows = await db.botRoute.findMany({ where: { at: { gte: new Date(Date.now() - hours * 3_600_000) } } })
    return { data: { hours, ...routeStats(rows as any) } }
  })
}

type Decision = { agent: string | null; shouldRespond: boolean }
type Row = { reason: string; error: string | null; agree: boolean | null; latencyMs: number | null; cold: boolean; ai: Decision | null; deterministic: Decision; label: Decision | null }

export function routeStats(rows: Row[]) {
  const answered = rows.filter((r) => !r.error && r.ai)
  const pct = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : null)
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null)
  const un = answered.filter((r) => r.reason === 'unmentioned')
  const me = answered.filter((r) => r.reason === 'mentioned')
  const handoffs = un.filter((r) => r.ai!.shouldRespond)
  const byAgent: Record<string, number> = {}
  for (const r of handoffs) byAgent[r.ai!.agent!] = (byAgent[r.ai!.agent!] ?? 0) + 1
  const warm = answered.filter((r) => !r.cold).map((r) => r.latencyMs ?? 0).sort((a, b) => a - b)
  const cold = rows.filter((r) => r.cold)

  // Labeled rows: router (respond/none) × truth (respond/none).
  const labeled = answered.filter((r) => r.label)
  const c = { respondRespond: 0, respondNone: 0, noneRespond: 0, noneNone: 0 }
  let rightAgent = 0
  for (const r of labeled) {
    const ai = r.ai!.shouldRespond, truth = r.label!.shouldRespond
    if (ai && truth) { c.respondRespond++; if (r.ai!.agent === r.label!.agent) rightAgent++ }
    else if (ai) c.respondNone++
    else if (truth) c.noneRespond++
    else c.noneNone++
  }
  const routerResponds = c.respondRespond + c.respondNone
  return {
    calls: rows.length,
    errors: { timeout: rows.filter((r) => r.error === 'timeout').length, other: rows.filter((r) => r.error && r.error !== 'timeout').length },
    unmentioned: { answered: un.length, disagreementRate: rate(un.filter((r) => r.agree === false).length, un.length), handoffs: handoffs.length, byAgent },
    mentioned: { answered: me.length, agreementRate: rate(me.filter((r) => r.agree).length, me.length) },
    latencyMs: { warm: { n: warm.length, p50: pct(warm, 0.5), p95: pct(warm, 0.95) }, cold: { n: cold.length, latencies: cold.map((r) => r.latencyMs), timeouts: cold.filter((r) => r.error === 'timeout').length } },
    labeled: {
      n: labeled.length,
      confusion: c,
      // Of the router's "respond" calls a human agreed with, how often it picked the right bot.
      handoffPrecision: rate(rightAgent, routerResponds),
      falseRespond: c.respondNone, // router spoke up where nobody should have
      falseNone: c.noneRespond, // router said nobody where a bot should have answered
      // Same truth, deterministic matcher — the baseline the router must beat.
      deterministic: baseline(labeled),
    },
  }
}

function baseline(rows: Row[]) {
  let right = 0, falseRespond = 0, falseNone = 0
  for (const r of rows) {
    const d = r.deterministic, t = r.label!
    if (d.shouldRespond && !t.shouldRespond) falseRespond++
    else if (!d.shouldRespond && t.shouldRespond) falseNone++
    else if (d.shouldRespond === t.shouldRespond && (!t.shouldRespond || d.agent === t.agent)) right++
  }
  return { correct: right, falseRespond, falseNone }
}
