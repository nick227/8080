export type Desk = 'team' | 'work' | 'calendar'

export const DESKS: { id: Desk; label: string }[] = [
  { id: 'team', label: 'Team' },
  { id: 'work', label: 'Work' },
  { id: 'calendar', label: 'Calendar' },
]

// Lenses on one business graph: person, communication, opportunity.
export type WorkLens = 'inbox' | 'contacts' | 'sales' | 'documents'

export const WORK_LENSES: { id: WorkLens; label: string; empty: string }[] = [
  { id: 'inbox', label: 'Inbox', empty: 'Nothing waiting.' },
  { id: 'contacts', label: 'Contacts', empty: 'No one saved yet.' },
  { id: 'sales', label: 'Sales', empty: 'No leads yet.' },
  { id: 'documents', label: 'Documents', empty: 'No documents yet.' },
]

export type InboxNote = { id: string; from: string; subject: string }
export type CalendarEvent = { id: string; title: string; when: string }
export type Contact = { id: string; name: string; role: string }
export type Lead = { id: string; name: string; stage: string }

export const inbox: InboxNote[] = []
export const calendar: CalendarEvent[] = []
export const contacts: Contact[] = []
export const leads: Lead[] = []

export function lensCount(lens: Exclude<WorkLens, 'documents'>) {
  if (lens === 'inbox') return inbox.length
  if (lens === 'contacts') return contacts.length
  return leads.length
}
