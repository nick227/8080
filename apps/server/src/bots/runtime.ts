// The bot runtime (doc/08 §4). Pipeline:
//   domain events → trigger matcher (per seated bot) → run (workflow instance)
//   → steps: wait (outside the lane) · guard → choose → act (inside the room lane)
//   → rails → ItemService as the bot user → BotDecision log
//
// Rules this file keeps:
// - Nothing captured when a run started is trusted after a wait: guards and rails
//   re-read seating, presence and items, so a stale run just ends with a reason.
// - One lane per room across all bots: at most one bot action in flight per room.
// - Bot-authored events never trigger workflows (loop guard).
// - Every run that starts ends in exactly one BotDecision (posted or skipped).
import { db, Prisma } from '@project/db'
import { humanAuthoredWhere } from '../lib/authorship'
import { ItemService } from '../services/ItemService'
import { events, type DomainEvents } from '../services/events'
import { roomPresence } from '../services/presence'
import { classify, mentionedBots, type Classified } from './classify'
import { draw, score, type Candidate, type Filtered, type History } from './choose'
import { GUARDS, greetedSince, type GuardCtx } from './guards'
import { BOT_LIMITS, botsEnabled } from './limits'
import type { GuardSpec, LineDef, Pack, Step, Trigger, Workflow } from './pack'
import { rngFrom, seedOf } from './rng'
import { seatedBots } from './seating'
import { seedPacks, type SeededBot } from './seed'

const items = new ItemService()
const DAY_MS = 86_400_000
const RETENTION_DAYS = Number(process.env.BOT_DECISION_RETENTION_DAYS ?? 7)

type TriggerInfo = {
  type: Trigger
  eventId: string
  itemId?: string
  actorId?: string
  chat?: boolean
  text?: string | null
  roomOwnerId?: string
}

type Run = {
  id: string
  bot: SeededBot
  workflow: Workflow
  roomId: string
  key: string
  trigger: TriggerInfo
  subjects: Set<string>
  collecting: boolean
  aborted: boolean
  /** Set when the run must end now (e.g. the bot was kicked); logged as the reason. */
  cancelled?: string
  wake?: () => void
  done: Promise<void>
  // decision accumulators
  classified?: Classified
  choice?: { line: LineDef; text: string; asset: boolean }
  candidates: Candidate[]
  filtered: Filtered[]
  seed?: string
  draw?: number
  skipped?: string
  itemId?: string
  vars: Record<string, string | number>
}

class Skip extends Error {
  constructor(readonly reason: string, readonly final = false) {
    super(reason)
  }
}

export type RuntimeOptions = {
  packs: Pack[]
  /** Multiplies every wait and the idle window (0 = no waiting). Default BOT_TIME_SCALE or 1. */
  timeScale?: number
  /** No human item for this long while someone is here → room.idle. Default BOT_IDLE_SEC or 240s. */
  idleMs?: number
}

export class BotRuntime {
  private bots: SeededBot[] = []
  private runs = new Map<string, Run>() // `${botId}|${roomId}|${key}` → live run
  private lanes = new Map<string, Promise<void>>()
  private timers = new Set<{ timer: NodeJS.Timeout; resolve: () => void }>()
  private unsubscribe: (() => void)[] = []
  private idleTimers = new Map<string, NodeJS.Timeout>()
  private pendingTriggers = 0
  private stopped = false
  private seq = 0
  private readonly timeScale: number

  constructor(private readonly opts: RuntimeOptions) {
    const env = Number(process.env.BOT_TIME_SCALE)
    this.timeScale = opts.timeScale ?? (Number.isFinite(env) && env >= 0 ? env : 1)
  }

  async start() {
    this.bots = await seedPacks(this.opts.packs)
    await this.prune()
    const on = <K extends 'item.created' | 'member.joined' | 'presence.arrived' | 'seating.changed'>(name: K, fn: (e: DomainEvents[K]) => Promise<void>) =>
      this.unsubscribe.push(events.on(name, (e) => this.track(() => fn(e))))
    on('item.created', (e) => this.onItem(e))
    on('member.joined', (e) => this.onArrival('member.joined', e.roomId, e.userId))
    on('presence.arrived', (e) => this.onArrival('presence.arrived', e.roomId, e.userId))
    on('seating.changed', (e) => this.onSeating(e))
    return this
  }

  /** Stop listening; cancel waits; in-flight runs end without writing. */
  async stop() {
    this.stopped = true
    for (const u of this.unsubscribe) u()
    this.unsubscribe = []
    for (const t of this.timers) { clearTimeout(t.timer); t.resolve() }
    this.timers.clear()
    for (const t of this.idleTimers.values()) clearTimeout(t)
    this.idleTimers.clear()
    for (const run of this.runs.values()) run.aborted = true
    await Promise.allSettled([...this.runs.values()].map((r) => r.done))
  }

  /** Resolves when no trigger is being matched and no run is live (tests, dry runs). */
  async idle() {
    for (;;) {
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
      if (this.pendingTriggers === 0 && this.runs.size === 0) return
      await Promise.allSettled([...this.runs.values()].map((r) => r.done))
      while (this.pendingTriggers > 0) await new Promise((r) => setTimeout(r, 1))
    }
  }

  get seeded() {
    return this.bots
  }

  // ─── trigger matching ──────────────────────────────────────────────────────

  private async track(fn: () => Promise<void>) {
    if (this.stopped) return
    this.pendingTriggers++
    try {
      await fn()
    } catch (error) {
      console.error('[bots] trigger failed', error)
    } finally {
      this.pendingTriggers--
    }
  }

  private async onItem(e: DomainEvents['item.created']) {
    if (e.actorKind === 'bot') return // loop guard
    this.armIdle(e.roomId)
    const trigger: TriggerInfo = { type: 'item.created', eventId: `item:${e.itemId}`, itemId: e.itemId, actorId: e.actorId, chat: e.chat, text: e.text, roomOwnerId: e.roomOwnerId }
    const seated = await this.seatedIn(e.roomId)
    const mentioned = e.text ? mentionedBots(e.text, seated.map((b) => ({ id: b.botId, aliases: b.pack.aliases }))) : new Set<string>()
    for (const bot of seated) {
      for (const wf of bot.pack.workflows) {
        if (!wf.on.includes('item.created')) continue
        if (wf.when.mentions === 'self' && !mentioned.has(bot.botId)) continue
        if (wf.when.actor === 'human' && e.actorKind !== 'human') continue
        if (wf.when.firstHumanItem && !e.firstHumanItem) continue
        const subjects = wf.when.firstHumanItem ? [e.actorId] : []
        await this.startRun(bot, wf, e.roomId, trigger, subjects)
      }
    }
  }

  private async onArrival(type: 'member.joined' | 'presence.arrived', roomId: string, userId: string) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { kind: true } })
    if (!user || user.kind !== 'human') return
    if (type === 'presence.arrived') this.armIdle(roomId)
    const trigger: TriggerInfo = { type, eventId: `${type}:${userId}:${Date.now()}` }
    for (const bot of await this.seatedIn(roomId)) {
      for (const wf of bot.pack.workflows) {
        if (wf.on.includes(type)) await this.startRun(bot, wf, roomId, trigger, [userId])
      }
    }
  }

  // Kicked → every live run of that bot in the room ends now ('kicked'). Seated →
  // that bot's bot.seated workflows (an introduction).
  private async onSeating(e: DomainEvents['seating.changed']) {
    const bot = this.bots.find((b) => b.botId === e.botId)
    if (!bot) return
    if (!e.seated) {
      for (const run of this.runs.values()) {
        if (run.bot.botId !== e.botId || run.roomId !== e.roomId) continue
        run.cancelled = 'kicked'
        run.wake?.()
      }
      return
    }
    const trigger: TriggerInfo = { type: 'bot.seated', eventId: `seated:${e.botId}:${Date.now()}`, actorId: e.byUserId }
    for (const wf of bot.pack.workflows) if (wf.on.includes('bot.seated')) await this.startRun(bot, wf, e.roomId, trigger, [])
  }

  // room.idle: someone is here but no human has posted for the idle window. Armed by
  // human items and arrivals; fires once per quiet spell (not re-armed by bot posts).
  private armIdle(roomId: string) {
    if (this.stopped) return
    const env = Number(process.env.BOT_IDLE_SEC)
    const idleMs = this.opts.idleMs ?? (Number.isFinite(env) && env > 0 ? env * 1000 : 240_000)
    clearTimeout(this.idleTimers.get(roomId))
    const timer = setTimeout(() => {
      this.idleTimers.delete(roomId)
      void this.track(async () => {
        if (roomPresence.here(roomId).length === 0) return
        const trigger: TriggerInfo = { type: 'room.idle', eventId: `idle:${roomId}:${Date.now()}` }
        for (const bot of await this.seatedIn(roomId)) {
          for (const wf of bot.pack.workflows) if (wf.on.includes('room.idle')) await this.startRun(bot, wf, roomId, trigger, [])
        }
      })
    }, idleMs * this.timeScale)
    timer.unref?.()
    this.idleTimers.set(roomId, timer)
  }

  // ─── dev tools (doc/08 R25) ────────────────────────────────────────────────

  /** Start a workflow by hand — it runs (and posts) exactly as if triggered. */
  async fire(handle: string, workflowId: string, roomId: string, opts: { userId?: string; itemId?: string } = {}) {
    const bot = this.bots.find((b) => b.pack.handle === handle)
    const wf = bot?.pack.workflows.find((w) => w.id === workflowId)
    if (!bot || !wf) throw { statusCode: 404, message: 'Unknown bot or workflow' }
    let trigger: TriggerInfo = { type: wf.on[0]!, eventId: `fire:${Date.now()}` }
    if (opts.itemId) {
      const item = await db.item.findUniqueOrThrow({ where: { id: opts.itemId }, include: { message: true, room: { select: { ownerId: true } } } })
      trigger = { ...trigger, itemId: item.id, actorId: item.message.authorId, chat: item.chat, text: item.message.text, roomOwnerId: item.room.ownerId }
    }
    await this.startRun(bot, wf, roomId, trigger, opts.userId ? [opts.userId] : [])
  }

  /** Classify + score a pool for some text, against this room's history. Posts nothing. */
  async dryRun(handle: string, roomId: string, text: string, pool = 'summon') {
    const bot = this.bots.find((b) => b.pack.handle === handle)
    if (!bot) throw { statusCode: 404, message: 'Unknown bot' }
    const run = { bot, roomId, subjects: new Set<string>(), trigger: { type: 'item.created', eventId: 'dry-run', text } } as unknown as Run
    const vars = await this.vars(run)
    vars.author = vars.author ?? 'you'
    const classified = classify(text, bot.pack.classifier)
    const { candidates, filtered } = score(bot.pack.lines.filter((l) => l.pool === pool), {
      intentScores: new Map(classified.intents.map((i) => [i.intent, i.score])),
      fallback: 'smalltalk',
      history: await this.history(run),
      now: new Date(),
      fillable: (line) => fill(line.text, vars) !== null,
    })
    return { intents: classified.intents, candidates, filtered, packVersion: bot.pack.version }
  }

  private async seatedIn(roomId: string) {
    const seated = new Set((await seatedBots(roomId)).map((b) => b.id))
    return this.bots.filter((b) => seated.has(b.botId))
  }

  private async startRun(bot: SeededBot, wf: Workflow, roomId: string, trigger: TriggerInfo, subjects: string[]) {
    if (this.stopped) return
    const key = wf.key
      .replaceAll('{roomId}', roomId)
      .replaceAll('{itemId}', trigger.itemId ?? '')
      .replaceAll('{userId}', subjects[0] ?? '')
    const id = `${bot.botId}|${roomId}|${key}`
    const live = this.runs.get(id)
    if (live) {
      // Same key already running: merge into its collect window, else drop (dedupe).
      if (live.collecting) for (const s of subjects) live.subjects.add(s)
      return
    }
    if (wf.once) {
      const decided = await db.botOnce.findUnique({ where: { botId_roomId_key: { botId: bot.botId, roomId, key } }, select: { id: true } })
      if (decided || this.runs.has(id)) return
    }
    const run: Run = {
      id, bot, workflow: wf, roomId, key, trigger, subjects: new Set(subjects), collecting: false, aborted: false,
      done: Promise.resolve(), candidates: [], filtered: [], vars: {},
    }
    this.runs.set(id, run)
    run.done = this.execute(run).finally(() => {
      if (this.runs.get(id) === run) this.runs.delete(id)
    })
  }

  // ─── execution ─────────────────────────────────────────────────────────────

  private rng(run: Run, stepIndex: number) {
    const seed = seedOf(run.bot.botId, run.roomId, run.trigger.eventId, stepIndex, run.bot.pack.version)
    return { seed, next: rngFrom(seed) }
  }

  private async execute(run: Run) {
    const steps = run.workflow.steps
    try {
      let i = 0
      while (i < steps.length) {
        const step = steps[i]!
        if (step.kind === 'wait') {
          await this.wait(run, step, i)
          i++
          continue
        }
        // Contiguous non-wait steps run inside the room lane.
        let j = i
        while (j < steps.length && steps[j]!.kind !== 'wait') j++
        const segment = steps.slice(i, j)
        const offset = i
        await this.lane(run.roomId, () => this.runSegment(run, segment, offset))
        i = j
      }
    } catch (error) {
      if (error instanceof Skip) {
        run.skipped = error.reason
        if (error.final && run.workflow.once && !run.aborted) await this.claimOnce(db, run, 'skipped', error.reason).catch(() => undefined)
      } else {
        run.skipped = 'error'
        console.error(`[bots] ${run.bot.pack.handle}/${run.workflow.id} failed`, error)
      }
    }
    if (!run.aborted) await this.record(run).catch((error) => console.error('[bots] decision log failed', error))
  }

  private async wait(run: Run, step: Extract<Step, { kind: 'wait' }>, index: number) {
    const u = this.rng(run, index).next()
    const delay = step.minMs + u * (step.maxMs - step.minMs)
    const ms = Math.max(delay, step.collectMs) * this.timeScale
    if (step.collectMs > 0) run.collecting = true
    await new Promise<void>((resolve) => {
      const entry = { timer: setTimeout(() => done(), ms), resolve }
      const done = () => { clearTimeout(entry.timer); this.timers.delete(entry); run.wake = undefined; resolve() }
      entry.timer.unref?.()
      this.timers.add(entry)
      run.wake = done
    })
    run.collecting = false
    if (run.aborted || this.stopped) throw new Skip('stopped')
    if (run.cancelled) throw new Skip(run.cancelled)
  }

  private lane<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.lanes.get(roomId) ?? Promise.resolve()
    const result = prev.then(fn)
    const tail = result.then(() => undefined, () => undefined)
    this.lanes.set(roomId, tail)
    void tail.then(() => {
      if (this.lanes.get(roomId) === tail) this.lanes.delete(roomId)
    })
    return result
  }

  private async runSegment(run: Run, steps: Step[], offset: number): Promise<void> {
    for (const [n, step] of steps.entries()) {
      if (run.aborted || this.stopped) throw new Skip('stopped')
      if (run.cancelled) throw new Skip(run.cancelled)
      const index = offset + n
      switch (step.kind) {
        case 'guard':
          for (const g of step.guards) {
            const result = await this.guard(run, g, index)
            if (result !== true) throw new Skip(result, g.final)
          }
          break
        case 'branch': {
          let pass = true
          for (const g of step.if) if ((await this.guard(run, g, index)) !== true) { pass = false; break }
          await this.runSegment(run, pass ? step.then : step.else, index * 100)
          break
        }
        case 'choose':
          await this.choose(run, step, index)
          break
        case 'act':
          await this.act(run, step)
          break
        case 'wait':
          throw new Error('wait inside a lane segment')
      }
    }
  }

  private guard(run: Run, g: GuardSpec, index: number) {
    const ctx: GuardCtx = { botId: run.bot.botId, roomId: run.roomId, subjects: run.subjects, trigger: run.trigger, rng: this.rng(run, index).next, classifier: run.bot.pack.classifier }
    return GUARDS[g.name]!(ctx, g.arg)
  }

  // ─── choose ────────────────────────────────────────────────────────────────

  private async choose(run: Run, step: Extract<Step, { kind: 'choose' }>, index: number) {
    const vars = await this.vars(run)
    const pool = step.pool.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
    const source: LineDef[] = step.from === 'assets' ? run.bot.pack.assets : run.bot.pack.lines
    const lines = source.filter((l) => l.pool === pool)
    let intentScores: Map<string, number> | undefined
    if (step.byIntents) {
      run.classified = classify(run.trigger.text ?? '', run.bot.pack.classifier)
      intentScores = new Map(run.classified.intents.map((i) => [i.intent, i.score]))
    }
    const { candidates, filtered } = score(lines, {
      intentScores,
      fallback: step.fallback,
      history: await this.history(run),
      now: new Date(),
      fillable: (line) => fill(line.text, vars) !== null,
    })
    const { seed, next } = this.rng(run, index)
    const u = next()
    run.candidates = candidates
    run.filtered = filtered
    run.seed = seed
    run.draw = u
    const id = draw(candidates, u)
    if (!id) throw new Skip('no-candidates')
    const line = lines.find((l) => l.key === id)!
    run.choice = { line, text: fill(line.text, vars)!, asset: step.from === 'assets' }
  }

  private async history(run: Run): Promise<History> {
    const since = new Date(Date.now() - DAY_MS)
    const used = await db.botDecision.findMany({
      where: { botId: run.bot.botId, roomId: run.roomId, itemId: { not: null }, chosen: { not: null }, at: { gte: since } },
      orderBy: { at: 'desc' },
      select: { chosen: true, at: true },
      take: 200,
    })
    const lastBot = await db.item.findFirst({
      where: { roomId: run.roomId, NOT: humanAuthoredWhere },
      orderBy: { number: 'desc' },
      select: { createdAt: true },
    })
    return { recent: used.map((u) => ({ key: u.chosen!, at: u.at })), lastBotPostAt: lastBot?.createdAt ?? null }
  }

  // Slot values, read now (never at run start).
  private async vars(run: Run) {
    const ids = [...run.subjects, ...(run.trigger.actorId ? [run.trigger.actorId] : [])]
    const [profiles, room, greetedBefore] = await Promise.all([
      db.profile.findMany({ where: { userId: { in: ids } }, select: { userId: true, displayName: true } }),
      db.room.findUnique({ where: { id: run.roomId }, select: { title: true, number: true } }),
      run.subjects.size ? greetedSince(run.bot.botId, run.roomId, new Date(Date.now() - RETENTION_DAYS * DAY_MS)) : Promise.resolve(new Set<string>()),
    ])
    const nameOf = (id: string) => profiles.find((p) => p.userId === id)?.displayName ?? 'friend'
    const subjects = [...run.subjects]
    const audience = subjects.length > 1 ? 'group' : subjects.some((s) => greetedBefore.has(s)) ? 'returning' : 'first'
    const hour = new Date().getHours()
    const vars: Record<string, string | number> = {
      audience,
      roomTitle: room ? room.title.trim() || `Conversation ${String(room.number).padStart(3, '0')}` : 'this room',
      timeOfDay: hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening',
      peopleCount: Math.max(roomPresence.here(run.roomId).length, subjects.length),
      botName: run.bot.pack.displayName,
    }
    if (subjects.length) vars.name = joinNames(subjects.map(nameOf))
    if (run.trigger.actorId) vars.author = nameOf(run.trigger.actorId)
    run.vars = vars
    return vars
  }

  // ─── act ───────────────────────────────────────────────────────────────────

  private async act(run: Run, step: Extract<Step, { kind: 'act' }>) {
    if (!run.choice) throw new Skip('nothing-chosen')
    await this.rails(run)
    const text = run.choice.text
    const onPlaced = async (tx: Prisma.TransactionClient, item: { id: string }) => {
      if (run.workflow.once) await this.claimOnce(tx, run, 'posted', null, item.id)
    }
    try {
      let created: { id: string }
      if (step.place) {
        const messageId = run.choice.asset ? run.bot.assets.get(run.choice.line.key) : undefined
        if (!messageId) throw new Skip('no-asset')
        const parentId = step.asReply ? run.trigger.itemId : undefined
        created = await items.placeExisting(run.bot.userId, run.roomId, messageId, { chat: step.place === 'chat', parentId }, { onPlaced })
      } else if (step.say) {
        created = await items.send(run.bot.userId, run.roomId, { text, chat: step.say === 'chat' }, { onPlaced })
      } else {
        if (!run.trigger.itemId) throw new Skip('no-item')
        const chat = step.reply === 'sameSurface' ? run.trigger.chat === true : step.reply === 'chat'
        created = await items.reply(run.bot.userId, run.trigger.itemId, { text, chat }, { onPlaced })
      }
      run.itemId = created.id
    } catch (error: any) {
      if (error instanceof Skip) throw error
      if (error?.code === 'BOT_CAP') throw new Skip('bot-cap')
      if (error?.code === 'BOT_NOT_SEATED') throw new Skip('not-seated')
      if (error?.code === 'P2002') throw new Skip('once-claimed')
      if (error?.statusCode === 404) throw new Skip('item-gone')
      throw error
    }
  }

  // Checked in this order at every act (doc/08 §4.5). The write transaction
  // re-checks seating (authorizeActor) and the cap (ItemService.botCap).
  private async rails(run: Run) {
    if (!botsEnabled()) throw new Skip('bots-off')
    if ((await GUARDS.seated!({ botId: run.bot.botId, roomId: run.roomId } as GuardCtx, undefined)) !== true) throw new Skip('not-seated')
    if ((await GUARDS.roomHasHumanItem!({ roomId: run.roomId } as GuardCtx, undefined)) !== true) throw new Skip('no-human-item')
    const since = new Date(Date.now() - BOT_LIMITS.roomCapWindowMs)
    const recent = await db.item.count({ where: { roomId: run.roomId, deletedAt: null, createdAt: { gte: since }, NOT: humanAuthoredWhere } })
    if (recent >= BOT_LIMITS.roomCap) throw new Skip('bot-cap')
    const last = await db.item.findMany({
      where: { roomId: run.roomId, deletedAt: null },
      orderBy: { number: 'desc' },
      take: BOT_LIMITS.maxConsecutive,
      select: { message: { select: { author: { select: { kind: true } } } } },
    })
    if (last.length >= BOT_LIMITS.maxConsecutive && last.every((i) => i.message.author.kind === 'bot')) throw new Skip('bot-cap')
  }

  private claimOnce(client: Prisma.TransactionClient | typeof db, run: Run, outcome: 'posted' | 'skipped', reason: string | null, itemId?: string) {
    return client.botOnce.create({ data: { botId: run.bot.botId, roomId: run.roomId, key: run.key, outcome, reason, itemId: itemId ?? null } })
  }

  // ─── decision log ──────────────────────────────────────────────────────────

  private record(run: Run) {
    return db.botDecision.create({
      data: {
        botId: run.bot.botId,
        roomId: run.roomId,
        workflow: run.workflow.id,
        runKey: run.key,
        trigger: { type: run.trigger.type, eventId: run.trigger.eventId, itemId: run.trigger.itemId ?? null, actorId: run.trigger.actorId ?? null, chat: run.trigger.chat ?? null },
        subjects: [...run.subjects],
        packVersion: run.bot.pack.version,
        classifierVersion: run.classified?.version ?? null,
        inputs: { text: run.trigger.text ?? null, intents: run.classified?.intents ?? [], vars: run.vars },
        candidates: run.candidates,
        filtered: run.filtered,
        rngSeed: run.seed ?? null,
        draw: run.draw ?? null,
        chosen: run.choice?.line.key ?? null,
        skippedReason: run.itemId ? null : (run.skipped ?? 'unknown'),
        itemId: run.itemId ?? null,
      },
    })
  }

  // Keep at least the longest cooldown/freshness window so pruning never resets one.
  private async prune() {
    const days = Math.max(RETENTION_DAYS, 1)
    await db.botDecision.deleteMany({ where: { at: { lt: new Date(Date.now() - days * DAY_MS) } } })
  }
}

/** Replace {slots}; null when a slot has no value (the line is not a candidate). */
export function fill(text: string, vars: Record<string, string | number>): string | null {
  let missing = false
  const out = text.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k]
    if (v === undefined || v === '') missing = true
    return String(v ?? '')
  })
  return missing ? null : out
}

/** "Ana" · "Ana and Raj" · "Ana, Raj and Lee" · "Ana, Raj, Lee and 4 others" */
export function joinNames(names: string[], max = 3) {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length > max) {
    const rest = names.length - max
    return `${names.slice(0, max).join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Exact replay of a logged decision: the same draw over the logged candidates. */
export function replayChoice(decision: { candidates: unknown; draw: number | null }) {
  if (decision.draw == null) return null
  return draw(decision.candidates as Candidate[], decision.draw)
}

let running: BotRuntime | null = null

/** Server boot: load packs, seed, listen. BOTS=off still runs (decisions log the skip). */
export async function startBots(packs: Pack[]) {
  running = await new BotRuntime({ packs }).start()
  return running
}

export function stopBots() {
  return running?.stop()
}

/** The running runtime (dev tools). */
export function botRuntime() {
  return running
}
