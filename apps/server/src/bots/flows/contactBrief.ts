// "Brief me" (doc/13 D3): read-only. Builds the evidence pack with the viewer's
// permissions, asks the model for a structured brief (grounded: every claim cites
// the pack; numbers and dates must be in what it cites), or uses the deterministic
// template when the assistant is off or the call fails. Stores it for this viewer.
// Changes no business record.
import { buildPack, selectForModel, storeBrief, templateBrief } from '../../services/contactBrief'
import { assistantAvailable, briefContact } from '../assistant/calls'

export async function generateBrief(userId: string, workspaceId: string, contactId: string) {
  const { contactName, pack } = await buildPack(userId, workspaceId, contactId)
  if (await assistantAvailable(workspaceId)) {
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const res = await briefContact({ workspaceId, runId: null }, { contact: contactName, today, evidence: selectForModel(pack).map(({ link: _link, ...e }) => e) })
    if (res) {
      const { dropped: _dropped, ...brief } = res.brief
      return storeBrief(userId, workspaceId, contactId, pack, brief, { generator: 'ai', model: res.model, callId: res.callId })
    }
  }
  return storeBrief(userId, workspaceId, contactId, pack, templateBrief(pack), { generator: 'template', model: null, callId: null })
}
