// Contact briefing (doc/13 D3) — read-only.
import { cachedBrief } from '../services/contactBrief'
import { generateBrief } from '../bots/flows/contactBrief'

export async function getContactBrief(r: any) {
  return { data: await cachedBrief(r.user.id, r.params.workspaceId, r.params.contactId) }
}
export async function generateContactBrief(r: any) {
  return { data: await generateBrief(r.user.id, r.params.workspaceId, r.params.contactId) }
}
