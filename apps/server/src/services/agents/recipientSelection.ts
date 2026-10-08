import { db, type Agent, type AgentEvent, type Workspace } from '@project/db'
import type { MergeValues, RecipientConfig } from '@project/shared'
import { audienceContacts, parseAudience, uniqueEmailCount } from '../contactAudience'
import { workspaceMembers } from './audiences'
import type { EmailRecipient } from './registry'

export const intrinsicAudience = (agent: Pick<Agent, 'family' | 'typeKey'>): RecipientConfig | null =>
  agent.family === 'team' || agent.family === 'social' || agent.typeKey === 'internal_messages' ? { source: 'WORKSPACE_MEMBERS' }
  : agent.family === 'followup' ? { source: 'TRIGGER_CONTACT' } : null
export function effectiveAudience(agent: Pick<Agent, 'family' | 'typeKey' | 'recipientConfig'>): RecipientConfig | null {
  const intrinsic = intrinsicAudience(agent)
  if (intrinsic) return intrinsic
  try {
    const config = parseAudience(agent.recipientConfig)
    return ['CONTACTS', 'SELECTED_CONTACTS'].includes(config.source) ? config : null
  } catch { return null }
}
export function recipientProblems(agent: Pick<Agent, 'family' | 'typeKey' | 'recipientConfig'>): string[] {
  return effectiveAudience(agent) ? [] : ['Add recipients before starting this Agent.']
}
export async function recipientCount(agent: Pick<Agent, 'workspaceId' | 'family' | 'typeKey' | 'recipientConfig'>) {
  const config = effectiveAudience(agent)
  if (!config || config.source === 'TRIGGER_CONTACT') return 0
  if (config.source === 'WORKSPACE_MEMBERS') return db.workspaceMember.count({ where: { workspaceId: agent.workspaceId, status: 'active' } })
  return uniqueEmailCount(await audienceContacts(agent.workspaceId, config))
}
export async function resolveRecipients(agent: Agent, event: AgentEvent, workspace: Workspace, base: MergeValues, now: Date): Promise<EmailRecipient[]> {
  const config = effectiveAudience(agent)
  if (!config) throw new Error('Add recipients before starting this Agent.')
  if (config.source === 'WORKSPACE_MEMBERS') return workspaceMembers(workspace, base)
  const contactId = (event.context as { contactId?: string } | null)?.contactId
  if (config.source === 'TRIGGER_CONTACT' && !contactId) throw new Error('This event has no trigger contact.')
  const contacts = await audienceContacts(workspace.id, config, now, contactId)
  return contacts.map(c => ({ contactId: c.id, address: c.primaryEmail, label: c.displayName, values: { ...base, 'contact.name': c.displayName, 'contact.firstName': c.firstName || c.displayName.split(/\s+/)[0], 'contact.email': c.primaryEmail } }))
}
