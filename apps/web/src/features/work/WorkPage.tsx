import { calendar, contacts, inbox, leads, type WorkSection } from './sections'

const EMPTY: Record<Exclude<WorkSection, 'team'>, string> = {
  inbox: 'Nothing waiting.',
  calendar: 'Nothing scheduled.',
  contacts: 'No one saved yet.',
  sales: 'No leads yet.',
}

export function WorkPage({ section }: { section: Exclude<WorkSection, 'team'> }) {
  const count = section === 'inbox' ? inbox.length
    : section === 'calendar' ? calendar.length
      : section === 'contacts' ? contacts.length
        : leads.length
  return (
    <section className="work-page" aria-label={section}>
      {count === 0 && <p className="work-empty">{EMPTY[section]}</p>}
    </section>
  )
}
