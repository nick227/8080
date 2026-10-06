// Agent proposals: the handler registry and the one view chat and record pages render
// (doc/13 §5). Pure — services/ProposalService.ts owns the lifecycle.
import type { AgentProposal, Prisma } from '@project/db'
import { badRequest } from './errors'
import type { WorkspaceVerb } from '../services/workspacePolicy'
import type { WorkspaceCtx } from '../services/WorkspaceService'

/** `key`: the row is editable under that name. `quote`: the source's own words (doc/13 §10 rule 10). */
export type DiffRow = { label: string; before: string; after: string; key?: string; value?: string; quote?: string }

export type ProposalHandler<P = any> = {
  targetType: string
  /** Who may see it, and who may apply / undo it. */
  readVerb: WorkspaceVerb
  applyVerb: WorkspaceVerb
  /** Validates the payload (throw badRequest), or returns it normalized. */
  validate(raw: unknown): P
  /** The target's current version, or null if it doesn't exist (in this workspace). */
  version(workspaceId: string, targetId: string): Promise<number | null>
  /** Title + before/after rows, computed against the current record. */
  describe(workspaceId: string, targetId: string, change: P): Promise<{ title: string; diff: DiffRow[] }>
  /** Applies through the normal service, refusing (409) if the target is no longer
   *  at baseVersion. Returns the version it produced and what Undo needs. */
  apply(ctx: WorkspaceCtx, workspaceId: string, targetId: string, change: P, baseVersion: number): Promise<{ resultVersion: number; undoData: unknown; targetId?: string }>
  /** Puts the old state back, refusing (409) unless the target is still at resultVersion. */
  undo(ctx: WorkspaceCtx, workspaceId: string, targetId: string, undoData: any, resultVersion: number): Promise<void>
  /** A change that restores undoData — for a corrective proposal when Undo can't run. */
  revert?(undoData: any): P
  /** Edits before Apply: returns the changed payload (validate runs after). */
  edit?(change: P, edits: Record<string, unknown>): P
  /** Refresh: the same intent planned again against today's records. */
  replan?(workspaceId: string, change: P): Promise<{ targetId: string; change: P }>
}

export const kinds = new Map<string, ProposalHandler>()
export function registerProposalKind(kind: string, handler: ProposalHandler) {
  kinds.set(kind, handler)
  return () => { if (kinds.get(kind) === handler) kinds.delete(kind) }
}
export const handlerOf = (kind: string) => {
  const h = kinds.get(kind)
  if (!h) throw badRequest(`Unknown proposal kind: ${kind}`, 'UNKNOWN_PROPOSAL_KIND')
  return h
}

type Row = AgentProposal & { decidedBy?: { user: { profile: { displayName: string } | null } } | null }
export const proposalInclude = { decidedBy: { include: { user: { include: { profile: true } } } } } satisfies Prisma.AgentProposalInclude

/** The one shape chat and record views render. `requires` lets a client hide buttons
 *  the server would refuse; the server still decides. */
export function toProposal(row: Row) {
  const timedOut = row.status === 'pending' && row.expiresAt.getTime() <= Date.now()
  const handler = kinds.get(row.kind)
  return {
    id: row.id,
    kind: row.kind,
    targetType: row.targetType,
    targetId: row.targetId,
    status: timedOut ? ('expired' as const) : row.status,
    title: (row.diff as { title?: string } | null)?.title ?? row.kind,
    diff: ((row.diff as { rows?: DiffRow[] } | null)?.rows ?? []) as DiffRow[],
    baseVersion: row.baseVersion,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy?.user.profile?.displayName ?? null,
    requires: handler && ['companyProfile.edit', 'record.delete', 'member.manage'].includes(handler.applyVerb) ? ('admin' as const) : ('member' as const),
    editable: !!handler?.edit,
    revertible: !!handler?.revert,
  }
}
export type ProposalView = ReturnType<typeof toProposal>

