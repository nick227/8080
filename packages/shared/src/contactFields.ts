/** Stable keys survive label changes. Typed built-ins are also usable by future settings. */
export type ContactFieldDefinition = {
  key: string
  label: string
  type: 'checkbox' | 'select' | 'number' | 'text' | 'date'
  options: { value: string; label: string }[]
  numberConfig?: { minimum?: number; maximum?: number; precision?: number; unit?: string }
  position: number
  archived: boolean
}
const field = (key: string, label: string, type: ContactFieldDefinition['type'], position: number, options: string[] = []): ContactFieldDefinition =>
  ({ key, label, type, position, archived: false, options: options.map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })) })
export const CONTACT_FIELD_DEFAULTS: ContactFieldDefinition[] = [
  field('location', 'Location', 'text', 130),
  field('contacted', 'Contacted', 'checkbox', 30),
  field('qualified', 'Qualified', 'checkbox', 31),
  field('proposalSent', 'Proposal sent', 'checkbox', 32),
  field('won', 'Won', 'checkbox', 33),
  field('nextAction', 'Next action', 'text', 10),
  field('interestedIn', 'Interested in', 'text', 70),
  field('lastContactedAt', 'Last contacted', 'date', 50),
  field('priority', 'Priority', 'select', 90, ['low', 'normal', 'high']),
  field('waitingOn', 'Waiting on', 'select', 100, ['us', 'them']),
  { ...field('potentialValue', 'Potential value', 'number', 110), numberConfig: { minimum: 0, maximum: 9999999999999.99, precision: 2 } },
]
export const CONTACT_MILESTONES = ['contacted', 'qualified', 'proposalSent', 'won'] as const
export const CONTACT_SORTS = ['name', 'company', 'owner', 'stage', 'followUp', 'lastContacted', 'interestedIn', 'contacted', 'qualified', 'proposalSent', 'won', 'potentialValue', 'priority', 'updated', 'activity'] as const
export type ContactSort = typeof CONTACT_SORTS[number]
export const CONTACT_FOCUSES = ['due', 'overdue', 'unassigned', 'neverContacted', 'waitingOnUs', 'needsProposal'] as const

export const CONTACT_MILESTONE_HELP: Record<typeof CONTACT_MILESTONES[number], string> = {
  contacted: 'Initial outreach was sent.', qualified: 'Fit and interest were confirmed.',
  proposalSent: 'Pricing or an offer was delivered.', won: 'A purchase or agreement was confirmed.',
}
