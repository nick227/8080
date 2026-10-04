// Bot packs: apps/server/bots/<handle>/{bot,classifier,lines,workflows}.yaml.
// Data only — guards and actions are a fixed, typed registry (workflow.ts), so a
// pack can compose behaviour but never express arbitrary logic. Invalid packs fail
// loudly at load (doc/08 §4.2).
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { load } from 'js-yaml'
import { GUARDS } from './guards'
import { parseDurationValue } from './time'

export const PACKS_DIR = resolve(__dirname, '../../bots')

export type Trigger = 'item.created' | 'member.joined' | 'presence.arrived' | 'bot.seated' | 'room.idle'
export type GuardSpec = { name: string; arg?: unknown; final: boolean }
export type Step =
  | { kind: 'wait'; minMs: number; maxMs: number; collectMs: number }
  | { kind: 'guard'; guards: GuardSpec[] }
  | { kind: 'choose'; from: 'lines' | 'assets'; pool: string; byIntents: boolean; fallback?: string }
  | { kind: 'act'; say?: 'chat' | 'stage'; reply?: 'sameSurface' | 'chat' | 'stage'; place?: 'stage' | 'chat'; asReply?: boolean }
  | { kind: 'branch'; if: GuardSpec[]; then: Step[]; else: Step[] }
export type Workflow = {
  id: string
  on: Trigger[]
  when: { mentions?: 'self'; actor?: 'human'; firstHumanItem?: boolean }
  key: string
  once: boolean
  steps: Step[]
}
export type LineDef = { key: string; pool: string; intents: string[]; tags: string[]; text: string; weight: number; cooldownSec: number; minGapSec: number; enabled: boolean }
export type ClassifierRule = { intent: string; score: number; patterns: RegExp[] }
/** Library media (doc/08 I2): a YouTube clip referenced by id, never downloaded. */
export type AssetDef = LineDef & { youtube: string; title: string }
export type Pack = {
  handle: string
  displayName: string
  kind: 'house' | 'optional'
  aliases: string[]
  persona: string
  classifier: { version: string; rules: ClassifierRule[] }
  lines: LineDef[]
  assets: AssetDef[]
  workflows: Workflow[]
  version: string
}

const TRIGGERS: Trigger[] = ['item.created', 'member.joined', 'presence.arrived', 'bot.seated', 'room.idle']

function fail(handle: string, what: string): never {
  throw new Error(`[bots] pack "${handle}": ${what}`)
}

function parseDuration(value: unknown, handle: string): number {
  try {
    return parseDurationValue(value)
  } catch (error) {
    fail(handle, (error as Error).message)
  }
}

function guards(raw: unknown, handle: string): GuardSpec[] {
  if (!Array.isArray(raw)) fail(handle, 'guard must be a list')
  return raw.map((g) => {
    const [name, arg] = typeof g === 'string' ? [g, undefined] : Object.entries(g as object)[0] ?? []
    if (typeof name !== 'string' || !(name in GUARDS)) fail(handle, `unknown guard ${JSON.stringify(name)}`)
    const final = typeof arg === 'object' && arg !== null && (arg as any).final === true
    return { name, arg, final }
  })
}

type Pools = { lines: Set<string>; assets: Set<string> }

function steps(raw: unknown, handle: string, pools: Pools): Step[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(handle, 'steps must be a non-empty list')
  return raw.map((s: any): Step => {
    if (s.wait) {
      const minMs = parseDuration(s.wait.min ?? 0, handle)
      const maxMs = parseDuration(s.wait.max ?? s.wait.min ?? 0, handle)
      if (maxMs < minMs) fail(handle, 'wait.max < wait.min')
      return { kind: 'wait', minMs, maxMs, collectMs: s.wait.collect ? parseDuration(s.wait.collect, handle) : 0 }
    }
    if (s.guard) return { kind: 'guard', guards: guards(s.guard, handle) }
    if (s.choose) {
      const from = s.choose.from === 'assets' ? 'assets' : 'lines'
      const known = pools[from]
      const pool = String(s.choose.pool ?? '')
      const resolved = pool.includes('{') ? [...known].filter((p) => p.startsWith(pool.split('{')[0]!)) : [pool]
      if (!pool || resolved.length === 0 || resolved.some((p) => !known.has(p))) fail(handle, `choose.pool "${pool}" has no ${from}`)
      return { kind: 'choose', from, pool, byIntents: s.choose.byIntents === true, fallback: s.choose.fallback }
    }
    if (s.act) {
      const { say, reply, place } = s.act
      if ([say, reply, place].filter(Boolean).length !== 1) fail(handle, 'act needs exactly one of say / reply / place')
      if (say && !['chat', 'stage'].includes(say)) fail(handle, `act.say ${say}`)
      if (reply && !['sameSurface', 'chat', 'stage'].includes(reply)) fail(handle, `act.reply ${reply}`)
      if (place && !['chat', 'stage'].includes(place)) fail(handle, `act.place ${place}`)
      return { kind: 'act', say, reply, place, asReply: s.act.asReply === true }
    }
    if (s.branch) {
      const inner = [...(s.branch.then ?? []), ...(s.branch.else ?? [])]
      if (inner.some((x: any) => x.wait)) fail(handle, 'branch steps cannot wait (waits release the room lane)')
      return { kind: 'branch', if: guards(s.branch.if, handle), then: s.branch.then ? steps(s.branch.then, handle, pools) : [], else: s.branch.else ? steps(s.branch.else, handle, pools) : [] }
    }
    fail(handle, `unknown step ${JSON.stringify(Object.keys(s))}`)
  })
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8')

export function loadPack(dir: string): Pack {
  const files = ['bot.yaml', 'classifier.yaml', 'lines.yaml', 'workflows.yaml']
  if (existsSync(join(dir, 'assets.yaml'))) files.push('assets.yaml')
  const texts = files.map((f) => read(dir, f))
  const [bot, classifier, lines, workflows, assets] = texts.map((t) => load(t)) as any[]
  const handle = String(bot?.handle ?? '')
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(handle)) fail(handle || dir, 'handle must be lowercase, 2–40 chars')
  if (!['house', 'optional'].includes(bot.kind)) fail(handle, 'kind must be house | optional')

  const rules: ClassifierRule[] = (classifier?.rules ?? []).map((r: any) => ({
    intent: String(r.intent),
    score: Number(r.score ?? 1),
    patterns: (r.patterns ?? []).map((p: string) => new RegExp(p, 'i')),
  }))
  if (!classifier?.version) fail(handle, 'classifier.version is required')

  const d = lines?.defaults ?? {}
  const seen = new Set<string>()
  const lineDefs: LineDef[] = (lines?.lines ?? []).map((l: any) => {
    if (!l.key || seen.has(l.key)) fail(handle, `duplicate or missing line key ${l.key}`)
    seen.add(l.key)
    if (!l.pool || !l.text) fail(handle, `line ${l.key} needs pool and text`)
    return {
      key: String(l.key), pool: String(l.pool), intents: l.intents ?? [], tags: l.tags ?? [], text: String(l.text),
      weight: Number(l.weight ?? d.weight ?? 1), cooldownSec: Number(l.cooldownSec ?? d.cooldownSec ?? 0),
      minGapSec: Number(l.minGapSec ?? d.minGapSec ?? 0), enabled: l.enabled !== false,
    }
  })
  const assetDefs: AssetDef[] = (assets?.assets ?? []).map((a: any) => {
    if (!a.key || seen.has(a.key)) fail(handle, `duplicate or missing asset key ${a.key}`)
    seen.add(a.key)
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(a.youtube ?? ''))) fail(handle, `asset ${a.key}: youtube must be an 11-char video id`)
    if (!a.pool || !a.caption) fail(handle, `asset ${a.key} needs pool and caption`)
    return {
      key: String(a.key), pool: String(a.pool), intents: a.intents ?? [], tags: a.tags ?? [], text: String(a.caption),
      weight: Number(a.weight ?? 1), cooldownSec: Number(a.cooldownSec ?? 0), minGapSec: Number(a.minGapSec ?? 0),
      enabled: a.enabled !== false, youtube: String(a.youtube), title: String(a.title ?? a.caption),
    }
  })
  const pools: Pools = { lines: new Set(lineDefs.map((l) => l.pool)), assets: new Set(assetDefs.map((a) => a.pool)) }

  const ids = new Set<string>()
  const flows: Workflow[] = (workflows ?? []).map((w: any) => {
    if (!w.id || ids.has(w.id)) fail(handle, `duplicate or missing workflow id ${w.id}`)
    ids.add(w.id)
    const on = Array.isArray(w.on) ? w.on : [w.on]
    if (on.some((t: string) => !TRIGGERS.includes(t as Trigger))) fail(handle, `workflow ${w.id}: unknown trigger in ${on}`)
    if (!w.key) fail(handle, `workflow ${w.id}: key is required`)
    return { id: String(w.id), on, when: w.when ?? {}, key: String(w.key), once: w.once === true, steps: steps(w.steps, handle, pools) }
  })

  const version = createHash('sha256').update(texts.join('\0')).digest('hex').slice(0, 12)
  return {
    handle, displayName: String(bot.displayName ?? handle), kind: bot.kind, aliases: (bot.aliases ?? [handle]).map(String),
    persona: String(bot.persona ?? ''), classifier: { version: String(classifier.version), rules }, lines: lineDefs, assets: assetDefs, workflows: flows, version,
  }
}

export function loadPacks(dir = process.env.BOTS_DIR ?? PACKS_DIR): Pack[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'bot.yaml')))
    .map((e) => loadPack(join(dir, e.name)))
}
