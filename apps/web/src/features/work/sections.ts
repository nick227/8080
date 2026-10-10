export type Desk = 'tasks' | 'company' | 'stream' | 'team' | 'inbox' | 'contacts' | 'inventory' | 'documents' | 'calendar' | 'board' | 'agents'

/** Desks shown in the workspace nav. Inbox is deferred until real inbound mail exists. */
export const DESKS: { id: Desk; label: string }[] = [
  { id: 'company', label: 'Company' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'stream', label: 'Stream' },
  { id: 'team', label: 'Team' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'documents', label: 'Documents' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'board', label: 'Board' },
  { id: 'agents', label: 'Automations' },
]

/** The tabular collections (redesign D9): one shared view, switched in its header. */
export const COLLECTIONS: { id: Desk; label: string; singular: string }[] = [
  { id: 'tasks', label: 'Tasks', singular: 'task' },
  { id: 'contacts', label: 'Contacts', singular: 'contact' },
  { id: 'inventory', label: 'Inventory', singular: 'item' },
  { id: 'team', label: 'Team', singular: 'member' },
  { id: 'documents', label: 'Documents', singular: 'document' },
  { id: 'agents', label: 'Automations', singular: 'automation' },
]
export const isCollection = (desk: Desk) => COLLECTIONS.some((c) => c.id === desk)

export type InboxNote = { id: string; from: string; subject: string }
export type CalendarEvent = { id: string; title: string; when: string }

export const inbox: InboxNote[] = []
export const calendar: CalendarEvent[] = []

export function deskEmpty(place: Desk) {
  if (place === 'inbox' && inbox.length === 0) return 'Nothing waiting.'
  if (place === 'calendar' && calendar.length === 0) return 'Nothing scheduled.'
  return null
}
