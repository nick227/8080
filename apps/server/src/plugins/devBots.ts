// Dev-only bot tuning endpoints (doc/08 R25). Registered only with BOTS_DEV=1 and
// never in production; outside the OpenAPI contract on purpose. No auth — local
// tuning only.
//   GET  /dev/bots                                    packs, versions, workflows
//   POST /dev/bots/dry-run   { handle, roomId, text, pool? }   classify + score, posts nothing
//   POST /dev/bots/fire      { handle, workflow, roomId, userId?, itemId? }   run it for real
//   POST /dev/bots/seat      { handle, roomId, seated }        seat/kick bypassing the owner check
//   GET  /dev/bots/decisions?roomId=&limit=           newest decisions first
//   GET  /dev/bots/routes?roomId=&limit=              AI router (shadow) vs deterministic, newest first
//   GET  /dev/bots/routes/stats?hours=24              agreement, errors, latency
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

  server.get('/dev/bots/routes', async (request: any) => {
    const { roomId, limit } = request.query ?? {}
    const rows = await db.botRoute.findMany({ where: roomId ? { roomId: String(roomId) } : {}, orderBy: { at: 'desc' }, take: Math.min(Number(limit) || 20, 200) })
    return { data: rows }
  })

  server.get('/dev/bots/routes/stats', async (request: any) => {
    const hours = Math.min(Number(request.query?.hours) || 24, 24 * 7)
    const rows = await db.botRoute.findMany({ where: { at: { gte: new Date(Date.now() - hours * 3_600_000) } }, select: { agree: true, error: true, latencyMs: true, reason: true } })
    const answered = rows.filter((r) => r.error === null)
    const lat = answered.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b)
    const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null)
    return {
      data: {
        hours, calls: rows.length, errors: rows.length - answered.length,
        agree: answered.filter((r) => r.agree).length, disagree: answered.filter((r) => r.agree === false).length,
        byReason: { mentioned: rows.filter((r) => r.reason === 'mentioned').length, sampled: rows.filter((r) => r.reason === 'sampled').length },
        latencyMs: { p50: pct(0.5), p95: pct(0.95) },
      },
    }
  })
}
