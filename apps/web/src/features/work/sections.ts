export type Desk = 'company' | 'team' | 'inbox' | 'contacts' | 'inventory' | 'documents' | 'calendar' | 'board' | 'agents'

/** Desks shown in the workspace nav. Inbox is deferred until real inbound mail exists. */
export const DESKS: { id: Desk; label: string }[] = [
  { id: 'company', label: 'Project' },
  { id: 'team', label: 'Team' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'documents', label: 'Documents' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'board', label: 'Board' },
  { id: 'agents', label: 'Messaging' },
]

export type InboxNote = { id: string; from: string; subject: string }
export type CalendarEvent = { id: string; title: string; when: string }

export const inbox: InboxNote[] = []
export const calendar: CalendarEvent[] = []

export function deskEmpty(place: Desk) {
  if (place === 'inbox' && inbox.length === 0) return 'Nothing waiting.'
  if (place === 'calendar' && calendar.length === 0) return 'Nothing scheduled.'
  return null
}
