// Messy notes → proposed CRM changes (doc/13 §10).
import { addNote } from '../bots/flows/noteToCrm'
import { proposals } from '../services/ProposalService'
import { workspaceCtx as ctx } from '../lib/session'

export async function addCrmNote(r: any, reply: any) {
  const result = await addNote(ctx(r), r.params.workspaceId, r.body)
  return reply.code(result.status === 'proposed' ? 201 : 200).send({ data: result })
}
export async function editProposal(r: any) {
  return { data: await proposals.edit(ctx(r), r.params.workspaceId, r.params.proposalId, r.body.edits) }
}
