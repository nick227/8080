// Dev-only bot tuning endpoints (doc/08 R25). Registered only with BOTS_DEV=1 and
// never in production; outside the OpenAPI contract on purpose. No auth — local
// tuning only.
//   GET  /dev/bots                                    packs, versions, workflows
//   POST /dev/bots/dry-run   { handle, roomId, text, pool? }   classify + score, posts nothing
//   POST /dev/bots/fire      { handle, workflow, roomId, userId?, itemId? }   run it for real
//   POST /dev/bots/seat      { handle, roomId, seated }        seat/kick bypassing the owner check
//   GET  /dev/bots/decisions?roomId=&limit=           newest decisions first
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
}
