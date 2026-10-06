export type Desk = 'team' | 'inbox' | 'contacts' | 'sales' | 'documents' | 'calendar'

/** Desks shown in the workspace nav. Inbox is deferred until real inbound mail exists. */
export const DESKS: { id: Desk; label: string }[] = [
  { id: 'team', label: 'Team' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'sales', label: 'Sales' },
  { id: 'documents', label: 'Documents' },
  { id: 'calendar', label: 'Calendar' },
]

export type InboxNote = { id: string; from: string; subject: string }
export type CalendarEvent = { id: string; title: string; when: string }
export type Contact = { id: string; name: string; role: string }
export type Lead = { id: string; name: string; stage: string }

export const inbox: InboxNote[] = []
export const calendar: CalendarEvent[] = []
export const contacts: Contact[] = []
export const leads: Lead[] = []

export function deskEmpty(place: Desk) {
  if (place === 'inbox' && inbox.length === 0) return 'Nothing waiting.'
  if (place === 'contacts' && contacts.length === 0) return 'No one saved yet.'
  if (place === 'sales' && leads.length === 0) return 'No leads yet.'
  if (place === 'calendar' && calendar.length === 0) return 'Nothing scheduled.'
  return null
}
