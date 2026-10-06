// Agent proposals (doc/13 §5).
import { proposals } from '../services/ProposalService'
import { workspaceCtx as ctx } from '../lib/session'

const ids = (r: any) => [r.params.workspaceId, r.params.proposalId] as const

export async function listProposals(r: any) {
  return { data: await proposals.list(r.user.id, r.params.workspaceId, r.query ?? {}) }
}
export async function createProposal(r: any, reply: any) {
  return reply.code(201).send({ data: await proposals.propose(ctx(r), r.params.workspaceId, r.body) })
}
export async function getProposal(r: any) { return { data: await proposals.get(r.user.id, ...ids(r)) } }
export async function applyProposal(r: any) { return { data: await proposals.apply(ctx(r), ...ids(r)) } }
export async function dismissProposal(r: any) { return { data: await proposals.dismiss(ctx(r), ...ids(r)) } }
export async function undoProposal(r: any) { return { data: await proposals.undo(ctx(r), ...ids(r)) } }
export async function revertProposal(r: any, reply: any) { return reply.code(201).send({ data: await proposals.revert(ctx(r), ...ids(r)) }) }
export async function refreshProposal(r: any, reply: any) { return reply.code(201).send({ data: await proposals.refresh(ctx(r), ...ids(r)) }) }
