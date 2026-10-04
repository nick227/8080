// Shadow routing (doc/08 Phase 2 slice 1): after the deterministic matcher has
// decided, maybe ask the AI router the same question and log both side by side.
// Never changes behaviour. The deterministic prefilter bounds cost: mentioned
// messages always, others sampled; per-room and per-day caps; a hard timeout.
import { db } from '@project/db'
import { routerConfig } from './config'
import { routerProvider, type RouterInput } from './router'
import { roomPresence } from '../../services/presence'
import { rngFrom, seedOf } from '../rng'
import type { Classified } from '../classify'
import type { SeededBot } from '../seed'

const RECENT = 6
let warmed = false // the process's first call pays connection setup; flagged cold

// Caps: max(logged rows, this process's own calls). The in-memory log is appended
// synchronously at reservation (no await between check and append), so concurrent
// messages can't all pass a stale DB count; the DB count carries history across
// restarts. Single instance, like the runtime itself.
const calls: { roomId: string; at: number }[] = []
function recentCalls(roomId: string, now: number) {
  while (calls.length && now - calls[0]!.at > 86_400_000) calls.shift()
  return { room: calls.filter((c) => c.roomId === roomId && now - c.at <= 600_000).length, day: calls.length }
}
const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export type ShadowArgs = {
  roomId: string
  itemId: string
  text: string
  chat: boolean
  actorId: string
  seated: SeededBot[]
  mentioned: Set<string> // botIds
  classified: Classified
}

export async function shadowRoute(a: ShadowArgs) {
  const provider = routerProvider()
  if (!provider || a.seated.length === 0 || !a.text.trim()) return
  const cfg = routerConfig()

  // Policy (doc/08 §4.9): explicit mentions are deterministic and never call the
  // model; no AI in empty rooms; only sampled unmentioned human messages.
  if (a.mentioned.size > 0) return
  if (roomPresence.here(a.roomId).length === 0) return
  if (rngFrom(seedOf('route', a.itemId))() >= cfg.sample) return
  const reason = 'unmentioned'
  const since10 = new Date(Date.now() - 600_000)
  const sinceDay = new Date(Date.now() - 86_400_000)
  const [inRoom, today, spent] = await Promise.all([
    db.botRoute.count({ where: { roomId: a.roomId, at: { gte: since10 } } }),
    db.botRoute.count({ where: { at: { gte: sinceDay } } }),
    db.botRoute.aggregate({ where: { at: { gte: sinceDay } }, _sum: { costUsd: true } }),
  ])
  const now = Date.now()
  const mine = recentCalls(a.roomId, now)
  if (Math.max(inRoom, mine.room) >= cfg.perRoomPer10Min || Math.max(today, mine.day) >= cfg.perDay) return
  if ((spent._sum.costUsd ?? 0) >= cfg.dailyUsd) return
  calls.push({ roomId: a.roomId, at: now })
  await callAndLog(a, provider, cfg, reason)
}

/** Tests: forget this process's call log. */
export function resetShadowCaps() {
  calls.length = 0
  warmed = false
}

async function callAndLog(a: ShadowArgs, provider: NonNullable<ReturnType<typeof routerProvider>>, cfg: ReturnType<typeof routerConfig>, reason: string) {

  const input = await buildInput(a)
  const firstMentioned = a.seated.find((b) => a.mentioned.has(b.botId))
  const deterministic = {
    agent: firstMentioned?.pack.handle ?? null,
    shouldRespond: !!firstMentioned,
    intents: a.classified.intents.map((i) => i.intent),
  }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  const cold = !warmed
  warmed = true
  let ai: Awaited<ReturnType<typeof provider.route>> | null = null
  let error: string | null = null
  try {
    ai = await provider.route(input, controller.signal)
  } catch (e) {
    error = controller.signal.aborted ? 'timeout' : String((e as Error)?.message ?? e).slice(0, 120)
  } finally {
    clearTimeout(timer)
  }
  await db.botRoute.create({
    data: {
      roomId: a.roomId, itemId: a.itemId, mode: 'shadow', provider: provider.name, model: provider.model, reason,
      trigger: 'item.created', inputChars: JSON.stringify(input).length,
      promptTokens: ai?.usage?.promptTokens ?? null, completionTokens: ai?.usage?.completionTokens ?? null,
      costUsd: ai?.usage ? (ai.usage.promptTokens * cfg.priceInPerM + ai.usage.completionTokens * cfg.priceOutPerM) / 1_000_000 : null,
      input, deterministic, ai: ai ? { agent: ai.agent, intent: ai.intent, confidence: ai.confidence, shouldRespond: ai.shouldRespond } : undefined, error,
      agree: ai ? ai.agent === deterministic.agent && ai.shouldRespond === deterministic.shouldRespond : null,
      latencyMs: Date.now() - started,
      cold,
    },
  })
}

async function buildInput(a: ShadowArgs): Promise<RouterInput> {
  const [room, author, recent] = await Promise.all([
    db.room.findUnique({ where: { id: a.roomId }, select: { title: true, number: true } }),
    db.profile.findUnique({ where: { userId: a.actorId }, select: { displayName: true } }),
    db.item.findMany({
      where: { roomId: a.roomId, deletedAt: null, id: { not: a.itemId } },
      orderBy: { number: 'desc' },
      take: RECENT,
      include: { message: { include: { author: { include: { profile: true } } } } },
    }),
  ])
  return {
    room: { title: room ? room.title.trim() || `Conversation ${String(room.number).padStart(3, '0')}` : '' },
    message: { author: author?.displayName ?? 'someone', text: clip(a.text, 500), surface: a.chat ? 'chat' : 'stage' },
    recent: recent.reverse().map((i) => ({
      author: `${i.message.author.profile?.displayName ?? 'someone'}${i.message.author.kind === 'bot' ? ' (BOT)' : ''}`,
      text: clip(i.message.text, 200),
    })).filter((r) => r.text),
    bots: a.seated.map((b) => ({ handle: b.pack.handle, name: b.pack.displayName, persona: clip(b.pack.persona, 300) })),
  }
}
