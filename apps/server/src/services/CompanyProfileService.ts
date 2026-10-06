// The workspace's company profile (doc/12 §5.2): durable facts the chatbot writes
// documents from. Scalars are columns, lists are CompanyFact rows, and every change is
// one action (runAction) that bumps the revision and stores a snapshot. A person's
// answer is `stated`; what a model read or tidied is `inferred`, and never replaces a
// stated or corrected fact (doc/12 §2).
import { db, type CompanyFactKind, type CompanyFactStatus, type CompanyServiceArea, type CompanyVoice, type Prisma } from '@project/db'
import { conflict } from '../lib/errors'
import { runAction } from './actions'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'

type Tx = Prisma.TransactionClient

export const SCALARS = ['name', 'location', 'serviceArea', 'purpose', 'brandVoice'] as const
export type Scalar = (typeof SCALARS)[number]
export const LISTS = { offerings: 'offering', customers: 'customer', differentiators: 'differentiator' } as const satisfies Record<string, CompanyFactKind>

/** What one interview establishes, with the answer each part came from. */
export type ProfileUpdate = {
  name?: string
  location?: string
  serviceArea?: CompanyServiceArea
  purpose?: string
  brandVoice?: CompanyVoice
  offerings?: string[]
  customers?: string[]
  differentiators?: string[]
  /** field → WorkflowAnswer id */
  sources: Partial<Record<Scalar | keyof typeof LISTS, string>>
  /** Fields a model read or tidied rather than a person stating them. They never
   *  replace a stored stated or corrected fact. */
  inferred?: (Scalar | keyof typeof LISTS)[]
  runId?: string
}

const factsWhere = (workspaceId: string) => ({ workspaceId, supersededAt: null }) satisfies Prisma.CompanyFactWhereInput

async function snapshot(client: Tx | typeof db, workspaceId: string) {
  const [profile, facts] = await Promise.all([
    client.companyProfile.findUnique({ where: { workspaceId } }),
    client.companyFact.findMany({ where: factsWhere(workspaceId), orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
  ])
  return {
    revision: profile?.revision ?? 0,
    name: profile?.name ?? null,
    location: profile?.location ?? null,
    serviceArea: profile?.serviceArea ?? null,
    purpose: profile?.purpose ?? null,
    brandVoice: profile?.brandVoice ?? null,
    facts: facts.map((f) => ({ id: f.id, kind: f.kind, value: f.value, status: f.status })),
    updatedAt: profile?.updatedAt ?? null,
  }
}
export type ProfileSnapshot = Awaited<ReturnType<typeof snapshot>>

/** One field of the profile, as it was — enough to put it back exactly (Undo). */
export type FieldSnapshot =
  | { field: Scalar; value: string | null; source: { status: CompanyFactStatus; sourceAnswerId: string | null; setByMemberId: string } | null }
  | { field: keyof typeof LISTS; facts: { value: string; status: CompanyFactStatus; sourceAnswerId: string | null; sourceRunId: string | null; setByMemberId: string }[] }
export type FieldValue = string | string[] | null
export const isList = (field: string): field is keyof typeof LISTS => field in LISTS

async function lockRevision(tx: Tx, workspaceId: string) {
  // Locking read: the latest committed revision, whatever snapshot the tx holds.
  const [row] = await tx.$queryRaw<{ revision: number }[]>`SELECT revision FROM CompanyProfile WHERE workspaceId = ${workspaceId} FOR UPDATE`
  return row?.revision ?? 0
}

async function snapshotField(tx: Tx, workspaceId: string, field: Scalar | keyof typeof LISTS): Promise<FieldSnapshot> {
  if (isList(field)) {
    const facts = await tx.companyFact.findMany({ where: { ...factsWhere(workspaceId), kind: LISTS[field] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    return { field, facts: facts.map((f) => ({ value: f.value, status: f.status, sourceAnswerId: f.sourceAnswerId, sourceRunId: f.sourceRunId, setByMemberId: f.setByMemberId })) }
  }
  const [profile, source] = await Promise.all([
    tx.companyProfile.findUnique({ where: { workspaceId } }),
    tx.companyScalarSource.findUnique({ where: { workspaceId_field: { workspaceId, field } } }),
  ])
  const value = (profile?.[field] as string | null | undefined) ?? null
  return { field, value, source: source ? { status: source.status, sourceAnswerId: source.sourceAnswerId, setByMemberId: source.setByMemberId } : null }
}

// Writes one field as given (a person's correction, or a restore) and records a revision.
async function writeField(tx: Tx, workspaceId: string, snapshot: FieldSnapshot) {
  const now = new Date()
  if ('facts' in snapshot) {
    await tx.companyFact.updateMany({ where: { ...factsWhere(workspaceId), kind: LISTS[snapshot.field] }, data: { supersededAt: now } })
    for (const f of snapshot.facts) await tx.companyFact.create({ data: { workspaceId, kind: LISTS[snapshot.field], ...f, value: f.value.slice(0, 500) } })
    return tx.companyProfile.upsert({ where: { workspaceId }, create: { workspaceId, revision: 1 }, update: { revision: { increment: 1 } } })
  }
  const data = { [snapshot.field]: snapshot.value } as Prisma.CompanyProfileUncheckedUpdateInput
  const profile = await tx.companyProfile.upsert({
    where: { workspaceId },
    create: { workspaceId, revision: 1, ...(data as object) },
    update: { revision: { increment: 1 }, ...data },
  })
  if (snapshot.source) {
    const src = { status: snapshot.source.status, sourceAnswerId: snapshot.source.sourceAnswerId, setByMemberId: snapshot.source.setByMemberId }
    await tx.companyScalarSource.upsert({ where: { workspaceId_field: { workspaceId, field: snapshot.field } }, create: { workspaceId, field: snapshot.field, ...src }, update: src })
  } else {
    await tx.companyScalarSource.deleteMany({ where: { workspaceId, field: snapshot.field } })
  }
  return profile
}

export class CompanyProfileService {
  async get(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'companyProfile.read')
    return snapshot(db, workspaceId)
  }

  /** The profile as the workflow sees it (no viewer; callers authorize). */
  current(workspaceId: string, client: Tx | typeof db = db) {
    return snapshot(client, workspaceId)
  }

  /** One interview's answers → one revision. A list that was answered replaces that
   *  list (the old rows are superseded, never deleted). Idempotent per key. */
  async apply(ctx: WorkspaceCtx, workspaceId: string, update: ProfileUpdate, idempotencyKey: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    const memberId = actor.member.id
    const fields = [...SCALARS, ...(Object.keys(LISTS) as (keyof typeof LISTS)[])].filter((f) => update[f] !== undefined)
    return runAction(
      { action: 'companyProfile.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, idempotencyKey, input: { fields, runId: update.runId ?? null }, target: { type: 'companyProfile', id: workspaceId } },
      async (tx) => {
        // The approval rule (doc/12 §2): an inferred value may fill a gap or replace an
        // inferred value, never something a person stated or corrected.
        const inferred = new Set(update.inferred ?? [])
        const firm = new Set((await tx.companyScalarSource.findMany({ where: { workspaceId, status: { in: ['stated', 'corrected'] } } })).map((s) => s.field))
        const firmKinds = new Set((await tx.companyFact.findMany({ where: { ...factsWhere(workspaceId), status: { in: ['stated', 'corrected'] } }, select: { kind: true } })).map((f) => f.kind))
        const skip = (field: Scalar | keyof typeof LISTS) =>
          inferred.has(field) && (field in LISTS ? firmKinds.has(LISTS[field as keyof typeof LISTS]) : firm.has(field))
        const scalars = Object.fromEntries(SCALARS.filter((f) => update[f] !== undefined && !skip(f)).map((f) => [f, update[f]]))
        const profile = await tx.companyProfile.upsert({
          where: { workspaceId },
          create: { workspaceId, revision: 1, ...scalars },
          update: { revision: { increment: 1 }, ...scalars },
        })
        for (const field of SCALARS) {
          if (update[field] === undefined || skip(field)) continue
          const data = { status: inferred.has(field) ? ('inferred' as const) : ('stated' as const), sourceAnswerId: update.sources[field] ?? null, setByMemberId: memberId }
          await tx.companyScalarSource.upsert({ where: { workspaceId_field: { workspaceId, field } }, create: { workspaceId, field, ...data }, update: data })
        }
        const now = new Date()
        for (const [list, kind] of Object.entries(LISTS) as [keyof typeof LISTS, CompanyFactKind][]) {
          const values = update[list]
          if (values === undefined || skip(list)) continue
          await tx.companyFact.updateMany({ where: { ...factsWhere(workspaceId), kind }, data: { supersededAt: now } })
          for (const value of values) {
            await tx.companyFact.create({ data: { workspaceId, kind, value: value.slice(0, 500), status: inferred.has(list) ? 'inferred' : 'stated', sourceAnswerId: update.sources[list] ?? null, sourceRunId: update.runId ?? null, setByMemberId: memberId } })
          }
        }
        const snap = await snapshot(tx, workspaceId)
        await tx.companyProfileRevision.create({ data: { workspaceId, revision: profile.revision, snapshot: snap as unknown as Prisma.InputJsonValue } })
        return { value: { revision: profile.revision }, targetId: workspaceId, result: { revision: profile.revision } }
      },
      async (previous) => ({ revision: (previous.result as { revision: number } | null)?.revision ?? 0 }),
    )
  }

  /** Sets one field, only if the profile is still at `expectedRevision` (else 409
   *  PROFILE_REVISION_CONFLICT). The value is `corrected`: a person decided it.
   *  Returns the new revision and the field as it was, for Undo. */
  async setField(ctx: WorkspaceCtx, workspaceId: string, input: { field: Scalar | keyof typeof LISTS; value: FieldValue; expectedRevision: number; idempotencyKey?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    const memberId = actor.member.id
    return runAction(
      { action: 'companyProfile.setField', workspaceId, actor: memberActor(actor), origin: ctx.origin, idempotencyKey: input.idempotencyKey, input: { field: input.field, expectedRevision: input.expectedRevision }, target: { type: 'companyProfile', id: workspaceId } },
      async (tx) => {
        if ((await lockRevision(tx, workspaceId)) !== input.expectedRevision) throw conflict('The company profile changed; reload it before applying', 'PROFILE_REVISION_CONFLICT')
        const before = await snapshotField(tx, workspaceId, input.field)
        const next: FieldSnapshot = isList(input.field)
          ? { field: input.field, facts: (Array.isArray(input.value) ? input.value : []).map((value) => ({ value, status: 'corrected' as const, sourceAnswerId: null, sourceRunId: null, setByMemberId: memberId })) }
          : { field: input.field as Scalar, value: typeof input.value === 'string' ? input.value : null, source: { status: 'corrected', sourceAnswerId: null, setByMemberId: memberId } }
        const profile = await writeField(tx, workspaceId, next)
        await tx.companyProfileRevision.create({ data: { workspaceId, revision: profile.revision, snapshot: (await snapshot(tx, workspaceId)) as unknown as Prisma.InputJsonValue } })
        return { value: { revision: profile.revision, before }, targetId: workspaceId, result: { revision: profile.revision } }
      },
    )
  }

  /** Puts one field back exactly as it was — only if the profile is still at
   *  `expectedRevision` (the revision the change being undone produced). */
  async restoreField(ctx: WorkspaceCtx, workspaceId: string, input: { before: FieldSnapshot; expectedRevision: number }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    return runAction(
      { action: 'companyProfile.restoreField', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { field: input.before.field, expectedRevision: input.expectedRevision }, target: { type: 'companyProfile', id: workspaceId } },
      async (tx) => {
        if ((await lockRevision(tx, workspaceId)) !== input.expectedRevision) throw conflict('The company profile changed since; this can no longer be undone', 'PROFILE_REVISION_CONFLICT')
        const profile = await writeField(tx, workspaceId, input.before)
        await tx.companyProfileRevision.create({ data: { workspaceId, revision: profile.revision, snapshot: (await snapshot(tx, workspaceId)) as unknown as Prisma.InputJsonValue } })
        return { value: { revision: profile.revision }, targetId: workspaceId, result: { revision: profile.revision } }
      },
    )
  }
}
