// The workspace's company profile (doc/12 §5.2): durable facts the chatbot writes
// documents from. Scalars are columns, lists are CompanyFact rows, and every change is
// one action (runAction) that bumps the revision and stores a snapshot. A person's
// answer is `stated`; what a model read or tidied is `inferred`, and never replaces a
// stated or corrected fact (doc/12 §2).
import { db, type CompanyFactKind, type CompanyFactStatus, type CompanyServiceArea, type CompanyVoice, type Prisma } from '@project/db'
import { badRequest, conflict } from '../lib/errors'
import { playbackUrl } from '../lib/serialize'
import { runAction } from './actions'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'

type Tx = Prisma.TransactionClient

export const SCALARS = ['name', 'location', 'serviceArea', 'purpose', 'brandVoice'] as const
export type Scalar = (typeof SCALARS)[number]
// Details are set by people on the company page; the setup interview never writes them.
export const DETAILS = ['legalName', 'website', 'industry', 'sizeRange', 'foundedYear', 'logoMediaId'] as const
export type Detail = (typeof DETAILS)[number]
export const SIZE_RANGES = ['1', '2-10', '11-50', '51-200', '201-1000', '1000+'] as const
// The setup interview (and assistant proposals) fill these lists; the page edits all LISTS.
export const INTERVIEW_LISTS = { offerings: 'offering', customers: 'customer', differentiators: 'differentiator' } as const satisfies Record<string, CompanyFactKind>
export const LISTS = { ...INTERVIEW_LISTS, goals: 'goal', links: 'link' } as const satisfies Record<string, CompanyFactKind>

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
  sources: Partial<Record<Scalar | keyof typeof INTERVIEW_LISTS, string>>
  /** Fields a model read or tidied rather than a person stating them. They never
   *  replace a stored stated or corrected fact. */
  inferred?: (Scalar | keyof typeof INTERVIEW_LISTS)[]
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
    imageUrl: profile?.imageUrl ?? null,
    legalName: profile?.legalName ?? null,
    website: profile?.website ?? null,
    industry: profile?.industry ?? null,
    sizeRange: profile?.sizeRange ?? null,
    foundedYear: profile?.foundedYear ?? null,
    logoUrl: profile?.logoMediaId ? playbackUrl(profile.logoMediaId) : null,
    facts: facts.map((f) => ({ id: f.id, kind: f.kind, value: f.value, status: f.status })),
    updatedAt: profile?.updatedAt ?? null,
  }
}
export type ProfileSnapshot = Awaited<ReturnType<typeof snapshot>>

/** One field of the profile, as it was — enough to put it back exactly (Undo). */
export type FieldSnapshot =
  | { field: Scalar | Detail; value: string | null; source: { status: CompanyFactStatus; sourceAnswerId: string | null; setByMemberId: string } | null }
  | { field: keyof typeof LISTS; facts: { value: string; status: CompanyFactStatus; sourceAnswerId: string | null; sourceRunId: string | null; setByMemberId: string }[] }
export type FieldValue = string | string[] | null
export const isList = (field: string): field is keyof typeof LISTS => field in LISTS

async function lockRevision(tx: Tx, workspaceId: string) {
  // Locking read: the latest committed revision, whatever snapshot the tx holds.
  const [row] = await tx.$queryRaw<{ revision: number }[]>`SELECT revision FROM CompanyProfile WHERE workspaceId = ${workspaceId} FOR UPDATE`
  return row?.revision ?? 0
}

async function snapshotField(tx: Tx, workspaceId: string, field: Scalar | Detail | keyof typeof LISTS): Promise<FieldSnapshot> {
  if (isList(field)) {
    const facts = await tx.companyFact.findMany({ where: { ...factsWhere(workspaceId), kind: LISTS[field] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    return { field, facts: facts.map((f) => ({ value: f.value, status: f.status, sourceAnswerId: f.sourceAnswerId, sourceRunId: f.sourceRunId, setByMemberId: f.setByMemberId })) }
  }
  const [profile, source] = await Promise.all([
    tx.companyProfile.findUnique({ where: { workspaceId } }),
    tx.companyScalarSource.findUnique({ where: { workspaceId_field: { workspaceId, field } } }),
  ])
  const raw = profile?.[field] as string | number | null | undefined
  const value = raw == null ? null : String(raw)
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
  // Scalar snapshots carry text; the founded year is stored as a number.
  const stored = snapshot.field === 'foundedYear' && snapshot.value !== null ? Number(snapshot.value) : snapshot.value
  const data = { [snapshot.field]: stored } as Prisma.CompanyProfileUncheckedUpdateInput
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
    const fields = [...SCALARS, ...(Object.keys(INTERVIEW_LISTS) as (keyof typeof INTERVIEW_LISTS)[])].filter((f) => update[f] !== undefined)
    return runAction(
      { action: 'companyProfile.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, idempotencyKey, input: { fields, runId: update.runId ?? null }, target: { type: 'companyProfile', id: workspaceId } },
      async (tx) => {
        // The approval rule (doc/12 §2): an inferred value may fill a gap or replace an
        // inferred value, never something a person stated or corrected.
        const inferred = new Set(update.inferred ?? [])
        const firm = new Set((await tx.companyScalarSource.findMany({ where: { workspaceId, status: { in: ['stated', 'corrected'] } } })).map((s) => s.field))
        const firmKinds = new Set((await tx.companyFact.findMany({ where: { ...factsWhere(workspaceId), status: { in: ['stated', 'corrected'] } }, select: { kind: true } })).map((f) => f.kind))
        const skip = (field: Scalar | keyof typeof INTERVIEW_LISTS) =>
          inferred.has(field) && (field in INTERVIEW_LISTS ? firmKinds.has(INTERVIEW_LISTS[field as keyof typeof INTERVIEW_LISTS]) : firm.has(field))
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
        for (const [list, kind] of Object.entries(INTERVIEW_LISTS) as [keyof typeof INTERVIEW_LISTS, CompanyFactKind][]) {
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

  /** Edit company profile: ordinary fields, saved together, only if the profile is still
   *  at `expectedRevision` (else 409). What a person sets here is `corrected` — the
   *  setup's reading never replaces it. Only the fields given change. */
  async update(ctx: WorkspaceCtx, workspaceId: string, input: { expectedRevision: number; changes: Partial<Record<Scalar | Detail | keyof typeof LISTS, unknown>> }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    const bad = (m: string) => badRequest(m, 'INVALID_PROFILE')
    const MAX: Record<Scalar | Detail, number> = { name: 200, location: 200, purpose: 1000, serviceArea: 0, brandVoice: 0, legalName: 200, website: 512, industry: 120, sizeRange: 0, foundedYear: 4, logoMediaId: 64 }
    const ENUMS: Partial<Record<Scalar | Detail, readonly string[]>> = { serviceArea: ['local', 'regional', 'national', 'global'], brandVoice: ['professional', 'friendly', 'bold', 'technical'], sizeRange: SIZE_RANGES }
    const fields = Object.keys(input.changes) as (Scalar | Detail | keyof typeof LISTS)[]
    if (!fields.length) throw bad('Nothing to change')
    // Numbers arrive as numbers; the snapshot machinery carries text.
    if (typeof input.changes.foundedYear === 'number') input.changes.foundedYear = String(input.changes.foundedYear)
    const logo = input.changes.logoMediaId
    if (typeof logo === 'string' && !(await db.media.findFirst({ where: { id: logo, ownerId: ctx.user.id, kind: 'image' }, select: { id: true } }))) {
      throw badRequest('The logo must be an image you uploaded', 'INVALID_LOGO')
    }
    const next: FieldSnapshot[] = fields.map((field) => {
      const raw = input.changes[field]
      if (isList(field)) {
        if (!Array.isArray(raw) || raw.length > 12 || raw.some((v) => typeof v !== 'string' || v.length > 500)) throw bad(`${field}: at most 12 items of up to 500 characters`)
        const values = [...new Set((raw as string[]).map((v) => v.trim().replace(/\s+/g, ' ')).filter(Boolean))]
        if (field === 'links' && values.some((v) => !isWebUrl(v))) throw bad('links: each one is a full https:// address')
        return { field, facts: values.map((value) => ({ value, status: 'corrected' as const, sourceAnswerId: null, sourceRunId: null, setByMemberId: actor.member.id })) }
      }
      if (![...SCALARS, ...DETAILS].includes(field as Scalar)) throw bad(`Unknown field ${field}`)
      const value = raw === null ? null : typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') || null : undefined
      if (value === undefined) throw bad(`${field} is text or null`)
      const allowed = ENUMS[field as Scalar | Detail]
      if (value !== null && (allowed ? !allowed.includes(value) : value.length > MAX[field as Scalar | Detail])) throw bad(allowed ? `${field} is one of ${allowed.join(', ')}` : `${field} is at most ${MAX[field as Scalar | Detail]} characters`)
      if (value !== null && field === 'website' && !isWebUrl(value)) throw bad('website is a full https:// address')
      if (value !== null && field === 'foundedYear' && !(/^\d{4}$/.test(value) && Number(value) >= 1800 && Number(value) <= new Date().getFullYear())) throw bad(`foundedYear is a year between 1800 and ${new Date().getFullYear()}`)
      return { field: field as Scalar | Detail, value, source: value === null ? null : { status: 'corrected' as const, sourceAnswerId: null, setByMemberId: actor.member.id } }
    })
    await runAction(
      { action: 'companyProfile.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { fields, expectedRevision: input.expectedRevision }, target: { type: 'companyProfile', id: workspaceId } },
      async (tx) => {
        if ((await lockRevision(tx, workspaceId)) !== input.expectedRevision) throw conflict('The company profile changed; reload it and save again', 'PROFILE_REVISION_CONFLICT')
        let revision = input.expectedRevision
        for (const field of next) revision = (await writeField(tx, workspaceId, field)).revision
        await tx.companyProfileRevision.create({ data: { workspaceId, revision, snapshot: (await snapshot(tx, workspaceId)) as unknown as Prisma.InputJsonValue } })
        return { value: revision, targetId: workspaceId, result: { revision } }
      },
    )
    return snapshot(db, workspaceId)
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

function isWebUrl(value: string) {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.')
  } catch {
    return false
  }
}
