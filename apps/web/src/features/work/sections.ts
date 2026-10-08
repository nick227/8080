export type Desk = 'company' | 'team' | 'inbox' | 'contacts' | 'inventory' | 'documents' | 'calendar' | 'agents'

/** Desks shown in the workspace nav. Inbox is deferred until real inbound mail exists. */
export const DESKS: { id: Desk; label: string }[] = [
  { id: 'company', label: 'Company' },
  { id: 'team', label: 'Team' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'documents', label: 'Documents' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'agents', label: 'Agents' },
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
