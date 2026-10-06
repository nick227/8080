// The workspace's company profile (doc/12 §5.2): durable facts the chatbot writes
// documents from. Scalars are columns, lists are CompanyFact rows, and every change is
// one action (runAction) that bumps the revision and stores a snapshot. A person's
// answer is `stated`; Slice C's model drafts will be `inferred` and may never replace a
// stated or corrected fact silently.
import { db, type CompanyFactKind, type CompanyServiceArea, type CompanyVoice, type Prisma } from '@project/db'
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
        const scalars = Object.fromEntries(SCALARS.filter((f) => update[f] !== undefined).map((f) => [f, update[f]]))
        const profile = await tx.companyProfile.upsert({
          where: { workspaceId },
          create: { workspaceId, revision: 1, ...scalars },
          update: { revision: { increment: 1 }, ...scalars },
        })
        for (const field of SCALARS) {
          if (update[field] === undefined) continue
          const data = { status: 'stated' as const, sourceAnswerId: update.sources[field] ?? null, setByMemberId: memberId }
          await tx.companyScalarSource.upsert({ where: { workspaceId_field: { workspaceId, field } }, create: { workspaceId, field, ...data }, update: data })
        }
        const now = new Date()
        for (const [list, kind] of Object.entries(LISTS) as [keyof typeof LISTS, CompanyFactKind][]) {
          const values = update[list]
          if (values === undefined) continue
          await tx.companyFact.updateMany({ where: { ...factsWhere(workspaceId), kind }, data: { supersededAt: now } })
          for (const value of values) {
            await tx.companyFact.create({ data: { workspaceId, kind, value: value.slice(0, 500), status: 'stated', sourceAnswerId: update.sources[list] ?? null, sourceRunId: update.runId ?? null, setByMemberId: memberId } })
          }
        }
        const snap = await snapshot(tx, workspaceId)
        await tx.companyProfileRevision.create({ data: { workspaceId, revision: profile.revision, snapshot: snap as unknown as Prisma.InputJsonValue } })
        return { value: { revision: profile.revision }, targetId: workspaceId, result: { revision: profile.revision } }
      },
      async (previous) => ({ revision: (previous.result as { revision: number } | null)?.revision ?? 0 }),
    )
  }
}
