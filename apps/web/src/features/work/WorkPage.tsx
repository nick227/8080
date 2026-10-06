import { useSession } from '@project/sdk'
import { CalendarExperience } from '../calendar/CalendarExperience'
import { DocumentsExperience } from '../documents/DocumentsExperience'
import { ContactsDesk } from '../inbox/ContactsDesk'
import { InboxExperience } from '../inbox/InboxExperience'
import { DESKS, deskEmpty, type Desk } from './sections'

export function WorkPage({ place, roomId, onPlace }: { place: Exclude<Desk, 'team' | 'calendar'>; roomId?: string; onPlace?: (desk: Desk) => void }) {
  const session = useSession()
  const owner = session.data?.data.displayName ?? 'You'
  const label = DESKS.find((item) => item.id === place)?.label ?? 'Work'
  const empty = deskEmpty(place)
  return (
    <section className="work-page" aria-label={label}>
      {place === 'documents' ? (
        <DocumentsExperience roomId={roomId} owner={owner} />
      ) : place === 'inbox' ? (
        <InboxExperience onPlace={onPlace} />
      ) : place === 'contacts' ? (
        <ContactsDesk />
      ) : empty ? (
        <p className="work-empty">{empty}</p>
      ) : null}
    </section>
  )
}

export function CalendarPage() {
  return (
    <section className="work-page" aria-label="Calendar">
      <CalendarExperience />
    </section>
  )
}
