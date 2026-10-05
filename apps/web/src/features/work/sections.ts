export type WorkSection = 'team' | 'inbox' | 'calendar' | 'contacts' | 'sales'

export const WORK_SECTIONS: { id: WorkSection; label: string }[] = [
  { id: 'team', label: 'Team' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'sales', label: 'Sales' },
]

export type InboxNote = { id: string; from: string; subject: string }
export type CalendarEvent = { id: string; title: string; when: string }
export type Contact = { id: string; name: string; role: string }
export type Lead = { id: string; name: string; stage: string }

// Empty until these desks have a real source. The pages render from these lists.
export const inbox: InboxNote[] = []
export const calendar: CalendarEvent[] = []
export const contacts: Contact[] = []
export const leads: Lead[] = []
