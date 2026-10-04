// Choosing a line (doc/08 §4.4) — pure, so a logged snapshot replays exactly.
//   1. candidates: enabled lines of the pool whose slots can be filled
//   2. filter: per-line cooldown, recent-use exclusion, min gap since any bot post
//   3. score: weight × intentScore × freshness
//   4. draw: one seeded uniform → weighted pick
import type { LineDef } from './pack'

export type Factors = { weight: number; intentScore: number; freshness: number }
export type Candidate = { id: string; score: number; factors: Factors }
export type Filtered = { id: string; reason: string }
export type History = {
  /** Line keys this bot used in this room, most recent first (last 24h). */
  recent: { key: string; at: Date }[]
  /** Last item by any bot in this room. */
  lastBotPostAt: Date | null
}

export const RECENT_K = 5
const DAY_MS = 86_400_000

export function score(
  lines: LineDef[],
  opts: { intentScores?: Map<string, number>; fallback?: string; history: History; now: Date; fillable: (line: LineDef) => boolean },
): { candidates: Candidate[]; filtered: Filtered[] } {
  const filtered: Filtered[] = []
  let pool = lines.filter((l) => {
    if (!l.enabled) return false
    if (!opts.fillable(l)) return filtered.push({ id: l.key, reason: 'slots' }), false
    return true
  })

  // Intent routing: lines answering a classified intent; else the fallback intent.
  const intentScore = new Map<string, number>()
  if (opts.intentScores) {
    const matched = pool.filter((l) => {
      const s = Math.max(0, ...l.intents.map((i) => opts.intentScores!.get(i) ?? 0))
      if (s > 0) intentScore.set(l.key, s)
      return s > 0
    })
    if (matched.length > 0) {
      for (const l of pool) if (!intentScore.has(l.key)) filtered.push({ id: l.key, reason: 'intent' })
      pool = matched
    } else {
      const fallback = pool.filter((l) => opts.fallback && l.intents.includes(opts.fallback))
      for (const l of pool) if (!fallback.includes(l)) filtered.push({ id: l.key, reason: 'intent' })
      for (const l of fallback) intentScore.set(l.key, 1)
      pool = fallback
    }
  }

  const now = opts.now.getTime()
  const { recent, lastBotPostAt } = opts.history
  // Never repeat back to back: exclude the last K used, but always leave one standing.
  const k = Math.min(RECENT_K, Math.max(pool.length - 1, 0))
  const excluded = new Set<string>()
  for (const r of recent) {
    if (excluded.size >= k) break
    if (pool.some((l) => l.key === r.key)) excluded.add(r.key)
  }

  const candidates: Candidate[] = []
  for (const l of pool) {
    const lastUse = recent.find((r) => r.key === l.key)?.at.getTime()
    if (l.cooldownSec > 0 && lastUse !== undefined && now - lastUse < l.cooldownSec * 1000) { filtered.push({ id: l.key, reason: 'cooldown' }); continue }
    if (excluded.has(l.key)) { filtered.push({ id: l.key, reason: 'recent' }); continue }
    if (l.minGapSec > 0 && lastBotPostAt && now - lastBotPostAt.getTime() < l.minGapSec * 1000) { filtered.push({ id: l.key, reason: 'min-gap' }); continue }
    const uses = recent.filter((r) => r.key === l.key && now - r.at.getTime() < DAY_MS).length
    const factors = { weight: l.weight, intentScore: intentScore.get(l.key) ?? 1, freshness: 1 / (1 + uses) }
    const s = factors.weight * factors.intentScore * factors.freshness
    if (s <= 0) { filtered.push({ id: l.key, reason: 'zero-weight' }); continue }
    candidates.push({ id: l.key, score: round(s), factors })
  }
  return { candidates, filtered }
}

/** Weighted pick by one uniform draw in [0, 1). Same candidates + draw → same id. */
export function draw(candidates: Candidate[], u: number): string | null {
  const total = candidates.reduce((sum, c) => sum + c.score, 0)
  if (total <= 0) return null
  let target = u * total
  for (const c of candidates) {
    target -= c.score
    if (target < 0) return c.id
  }
  return candidates.at(-1)!.id
}

const round = (n: number) => Math.round(n * 1e6) / 1e6
