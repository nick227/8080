// Bounded, logged AI calls for workflows (doc/12 §7.3). A call happens only in answer
// to a person (the workflow calls in), under per-workspace and global daily caps, a
// daily spend cap and a timeout. Every call is logged in AssistantCall — the only row
// this module writes. Anything short of a valid answer returns null, and the
// workflow takes its deterministic path.
import { db } from '@project/db'
import { assistantConfig } from './config'
import { flagCount, problemsOf, styleFlags } from './style'
import { assistantProvider, validateDraft, validateFacts, type AssistantProvider, type BriefInput, type DraftInput, type ExtractInput, type NoteInput, type Usage } from './provider'
import { groundBrief } from './briefGrounding'
import { ground } from './grounding'

export type AssistContext = { workspaceId: string; runId: string | null }

// This process's reservations, appended synchronously at reservation so concurrent
// callers can't all pass a stale DB count (same pattern as the router's caps).
const reserved: { workspaceId: string; at: number }[] = []
const DAY = 86_400_000

/** Tests: forget this process's reservations. */
export function resetAssistantCaps() {
  reserved.length = 0
}

// Logged calls in the last day (DB, survives restarts), this workspace's and all.
async function today(workspaceId: string) {
  const since = new Date(Date.now() - DAY)
  const [mine, all, spent] = await Promise.all([
    db.assistantCall.count({ where: { workspaceId, at: { gte: since } } }),
    db.assistantCall.count({ where: { at: { gte: since } } }),
    db.assistantCall.aggregate({ where: { at: { gte: since } }, _sum: { costUsd: true } }),
  ])
  return { mine, all, spent: spent._sum.costUsd ?? 0 }
}

async function reserve(workspaceId: string) {
  const provider = assistantProvider()
  if (!provider) return null
  const cfg = assistantConfig()
  const used = await today(workspaceId)
  const now = Date.now()
  while (reserved.length && now - reserved[0]!.at > DAY) reserved.shift()
  const local = reserved.filter((r) => r.workspaceId === workspaceId).length
  if (Math.max(used.mine, local) >= cfg.perWorkspacePerDay || Math.max(used.all, reserved.length) >= cfg.perDay) return null
  if (used.spent >= cfg.dailyUsd) return null
  reserved.push({ workspaceId, at: now })
  return { provider, cfg }
}

/** Whether a call would be made now (provider configured and under every cap). */
export async function assistantAvailable(workspaceId: string) {
  if (!assistantProvider()) return false
  const cfg = assistantConfig()
  const used = await today(workspaceId)
  return used.mine < cfg.perWorkspacePerDay && used.all < cfg.perDay && used.spent < cfg.dailyUsd
}

async function call<T extends { usage?: Usage }>(
  ctx: AssistContext,
  kind: 'extract' | 'generate',
  input: ExtractInput | DraftInput | NoteInput | BriefInput,
  run: (provider: AssistantProvider, signal: AbortSignal) => Promise<T>,
  /** Re-validates whatever the provider returned; null = unusable. */
  check: (out: T) => T | null,
  summarize: (out: T) => object,
): Promise<{ out: T; callId: string; model: string | null } | null> {
  const slot = await reserve(ctx.workspaceId)
  if (!slot) return null
  const { provider, cfg } = slot
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), kind === 'extract' ? cfg.extractTimeoutMs : cfg.generateTimeoutMs)
  let out: T | null = null
  let error: string | null = null
  try {
    out = check(await run(provider, controller.signal))
    if (!out) error = 'invalid output'
  } catch (e) {
    error = controller.signal.aborted ? 'timeout' : String((e as Error)?.message ?? e).slice(0, 160)
  } finally {
    clearTimeout(timer)
  }
  const usage = out?.usage
  const row = await db.assistantCall.create({
    data: {
      workspaceId: ctx.workspaceId, runId: ctx.runId, kind, provider: provider.name, model: provider.model,
      inputChars: JSON.stringify(input).length,
      promptTokens: usage?.promptTokens ?? null, completionTokens: usage?.completionTokens ?? null,
      costUsd: usage ? (usage.promptTokens * cfg.priceInPerM + usage.completionTokens * cfg.priceOutPerM) / 1_000_000 : null,
      latencyMs: Date.now() - started, error, result: out ? summarize(out) : undefined,
    },
  })
  return out ? { out, callId: row.id, model: provider.model } : null
}

/** Facts from a person's own description, or null (off, capped, failed, invalid). */
export async function extractFacts(ctx: AssistContext, input: ExtractInput) {
  const res = await call(ctx, 'extract', input, (p, s) => p.extract(input, s), (o) => ({ ...o, facts: validateFacts(o.facts) }), (o) => o.facts)
  return res && { facts: res.out.facts, callId: res.callId }
}

/** A drafted document + a tidy-up of the facts, or null. A draft that breaks the
 *  writing rules (style.ts) gets one targeted revision — kept only if it is valid and
 *  has fewer problems. The revision is a call of its own: logged and capped. */
export async function draftDocument(ctx: AssistContext, input: DraftInput) {
  const once = async (i: DraftInput) => {
    const source = JSON.stringify([i.profile, i.answers])
    const res = await call(ctx, 'generate', i, (p, s) => p.draft(i, s), (o) => {
      const document = validateDraft(o.document)
      return document ? { ...o, patch: validateFacts(o.patch), document } : null
    }, (o) => ({ patch: o.patch, document: o.document, style: styleFlags(o.document.paragraphs, i.brief.voice, source), revision: !!i.revise }))
    return res && { patch: res.out.patch, document: res.out.document, callId: res.callId, model: res.model, flags: styleFlags(res.out.document.paragraphs, i.brief.voice, source) }
  }
  const first = await once(input)
  if (!first || flagCount(first.flags) === 0) return first
  const second = await once({ ...input, revise: { previous: first.document, problems: problemsOf(first.flags) } })
  return second && flagCount(second.flags) < flagCount(first.flags) ? { ...second, patch: first.patch } : first
}

/** A note read and grounded (doc/13 §10), or null (off, capped, failed, invalid). */
export async function readNote(ctx: AssistContext, input: NoteInput) {
  const res = await call(ctx, 'extract', input, async (p, s) => {
    if (!p.readNote) throw new Error('provider cannot read notes')
    return p.readNote(input, s)
  }, (o) => ({ ...o, reading: ground(input.note, o.reading, input.today) }), (o) => o.reading)
  return res && { reading: (res.out.reading as ReturnType<typeof ground>), callId: res.callId }
}

/** A contact brief, grounded in the pack (doc/13 D3), or null. */
export async function briefContact(ctx: AssistContext, input: BriefInput) {
  const res = await call(ctx, 'generate', input, async (p, s) => {
    if (!p.brief) throw new Error('provider cannot brief')
    return p.brief(input, s)
  }, (o) => ({ ...o, brief: groundBrief(o.brief, input.evidence) }), (o) => o.brief)
  return res && { brief: res.out.brief as ReturnType<typeof groundBrief>, callId: res.callId, model: res.model }
}
