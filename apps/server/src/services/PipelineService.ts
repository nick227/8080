// Workspace sales pipeline stages. Seeded from DEFAULT_PIPELINE_STAGES; Company vocabulary edits them.
import { randomBytes } from 'crypto'
import { DEFAULT_PIPELINE_STAGES, type PipelineStageKind } from '@project/shared'
import { db, type Prisma } from '@project/db'
import { badRequest, conflict } from '../lib/errors'
import { runAction } from './actions'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'

type Tx = Prisma.TransactionClient
type Client = Tx | typeof db

export type StageRow = {
  id: string
  key: string
  label: string
  position: number
  kind: PipelineStageKind
  archived: boolean
  system: boolean
}

const KINDS = new Set<PipelineStageKind>(['open', 'won', 'lost'])
const KEY = /^[a-z][a-z0-9_-]{0,63}$/

function present(row: { id: string; key: string; label: string; position: number; kind: string; archived: boolean; system: boolean }): StageRow {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    position: row.position,
    kind: row.kind as PipelineStageKind,
    archived: row.archived,
    system: row.system,
  }
}

/** Idempotent seed — safe on every workspace create and first read. */
export async function ensurePipelineStages(client: Client, workspaceId: string) {
  const count = await client.pipelineStage.count({ where: { workspaceId } })
  if (count === 0) await client.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({
      workspaceId,
      key: s.key,
      label: s.label,
      position: s.position,
      kind: s.kind,
      system: s.system,
    })),
  })
  // Preserve old contacts' stage keys as visible vocabulary; never silently relabel them.
  const [known, used] = await Promise.all([
    client.pipelineStage.findMany({ where: { workspaceId }, select: { key: true, position: true } }),
    client.contact.findMany({ where: { workspaceId, deletedAt: null }, distinct: ['leadStatus'], select: { leadStatus: true } }),
  ])
  const keys = new Set(known.map(s => s.key))
  const missing = used.map(c => c.leadStatus).filter(key => key && !keys.has(key))
  const position = Math.max(0, ...known.map(s => s.position)) + 1
  if (missing.length) await client.pipelineStage.createMany({ data: missing.map((key, index) => ({ workspaceId, key, label: key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), kind: key === 'customer' ? 'won' : key === 'lost' ? 'lost' : 'open', position: position + index, system: false })), skipDuplicates: true })
}

/** Every creation path uses the workspace's configured first open stage. */
export async function defaultContactStage(client: Client, workspaceId: string): Promise<string> {
  await ensurePipelineStages(client, workspaceId)
  const stage = await client.pipelineStage.findFirst({ where: { workspaceId, archived: false, kind: 'open' }, orderBy: [{ position: 'asc' }, { key: 'asc' }] })
  if (!stage) throw badRequest('Add an active open pipeline stage before creating contacts', 'NO_DEFAULT_STAGE')
  return stage.key
}

export class PipelineService {
  async list(userId: string, workspaceId: string, opts?: { includeArchived?: boolean }) {
    await authorize(userId, workspaceId, 'companyProfile.read')
    await ensurePipelineStages(db, workspaceId)
    const rows = await db.pipelineStage.findMany({
      where: { workspaceId, ...(opts?.includeArchived ? {} : { archived: false }) },
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
    })
    return rows.map(present)
  }

  async openKeys(workspaceId: string): Promise<string[]> {
    await ensurePipelineStages(db, workspaceId)
    // In pipeline order: callers show and send these as a list.
    return (await db.pipelineStage.findMany({ where: { workspaceId, archived: false, kind: 'open' }, select: { key: true }, orderBy: [{ position: 'asc' }, { key: 'asc' }] })).map((r) => r.key)
  }

  async assertActiveKey(workspaceId: string, key: string | null | undefined) {
    if (key == null || key === '') return null
    await ensurePipelineStages(db, workspaceId)
    const row = await db.pipelineStage.findFirst({ where: { workspaceId, key, archived: false } })
    if (!row) throw badRequest('Unknown pipeline stage', 'INVALID_STAGE')
    return row.key
  }

  async update(
    ctx: WorkspaceCtx,
    workspaceId: string,
    input: {
      stages?: { id?: string; key?: string; label: string; position: number; kind: PipelineStageKind; archived?: boolean }[]
    },
  ) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    await ensurePipelineStages(db, workspaceId)
    const stages = input.stages
    if (!stages) throw badRequest('stages required', 'INVALID_INPUT')
    for (const s of stages) {
      if (!s.label.trim()) throw badRequest('Stage label required', 'INVALID_LABEL')
      if (s.label.length > 80) throw badRequest('Stage label too long', 'INVALID_LABEL')
      if (!KINDS.has(s.kind)) throw badRequest('Invalid stage kind', 'INVALID_KIND')
      if (s.key && !KEY.test(s.key)) throw badRequest('Invalid stage key', 'INVALID_KEY')
    }

    return runAction(
      {
        action: 'pipeline.update',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input,
        target: { type: 'pipeline', id: workspaceId },
      },
      async (tx) => {
        const existing = await tx.pipelineStage.findMany({ where: { workspaceId } })
        const byId = new Map(existing.map((r) => [r.id, r]))
        const keptIds = new Set<string>()

        for (const s of stages) {
          if (s.id && byId.has(s.id)) {
            const row = byId.get(s.id)!
            keptIds.add(row.id)
            await tx.pipelineStage.update({
              where: { id: row.id },
              data: {
                label: s.label.trim(),
                position: s.position,
                kind: s.kind,
                archived: s.archived ?? false,
              },
            })
          } else {
            const key = s.key?.trim() || `stage_${randomBytes(4).toString('hex')}`
            if (!KEY.test(key)) throw badRequest('Invalid stage key', 'INVALID_KEY')
            const dup = await tx.pipelineStage.findFirst({ where: { workspaceId, key } })
            if (dup) throw conflict('Stage key already exists', 'STAGE_KEY_TAKEN')
            const created = await tx.pipelineStage.create({
              data: {
                workspaceId,
                key,
                label: s.label.trim(),
                position: s.position,
                kind: s.kind,
                system: false,
                archived: s.archived ?? false,
              },
            })
            keptIds.add(created.id)
          }
        }

        for (const row of existing) {
          if (keptIds.has(row.id) || row.archived) continue
          const inUse = await tx.contact.count({ where: { workspaceId, leadStatus: row.key, deletedAt: null } })
          if (inUse > 0) throw conflict(`Stage “${row.label}” still has contacts`, 'STAGE_IN_USE')
          if (row.system) {
            await tx.pipelineStage.update({ where: { id: row.id }, data: { archived: true } })
          } else {
            await tx.pipelineStage.delete({ where: { id: row.id } })
          }
        }

        const rows = await tx.pipelineStage.findMany({
          where: { workspaceId, archived: false },
          orderBy: [{ position: 'asc' }, { key: 'asc' }],
        })
        return { value: rows.map(present) }
      },
    )
  }
}

export const pipelineService = new PipelineService()
