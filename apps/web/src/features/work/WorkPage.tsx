import { useSession } from '@project/sdk'
import { AgentsDesk } from '../agents/AgentsDesk'
import { CalendarExperience } from '../calendar/CalendarExperience'
import { CompanyDesk } from '../company/CompanyDesk'
import { DocumentsExperience } from '../documents/DocumentsExperience'
import { ContactsDesk } from '../inbox/ContactsDesk'
import { InventoryDesk } from '../inventory/InventoryDesk'
import { InboxExperience } from '../inbox/InboxExperience'
import { DESKS, deskEmpty, type Desk } from './sections'

export function WorkPage({ place, roomId, onPlace, onOpenComposer }: { place: Exclude<Desk, 'team' | 'stream' | 'calendar'>; roomId?: string; onPlace?: (desk: Desk) => void; onOpenComposer?: () => void }) {
  const session = useSession()
  const owner = session.data?.data.displayName ?? 'You'
  const label = DESKS.find((item) => item.id === place)?.label ?? 'Work'
  const empty = deskEmpty(place)
  return (
    <section className="work-page" aria-label={label}>
      {place === 'company' ? (
        <CompanyDesk roomId={roomId} onPlace={onPlace} onOpenComposer={onOpenComposer} />
      ) : place === 'documents' ? (
        <DocumentsExperience roomId={roomId} owner={owner} />
      ) : place === 'inbox' ? (
        <InboxExperience onPlace={onPlace} />
      ) : place === 'contacts' ? (
        <ContactsDesk />
      ) : place === 'inventory' ? (
        <InventoryDesk />
      ) : place === 'tasks' ? (
        <CalendarExperience section="tasks" />
      ) : place === 'board' ? (
        <CalendarExperience section="board" />
      ) : place === 'agents' ? (
        <AgentsDesk onPlace={onPlace} />
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
