import { useEffect, useState } from 'react'
import { useSession } from '@project/sdk'
import { DocumentsExperience } from '../documents/DocumentsExperience'
import { useDocuments } from '../documents/store'
import { calendar, lensCount, WORK_LENSES, type WorkLens } from './sections'

export function WorkPage({ roomId }: { roomId?: string }) {
  const openId = useDocuments((state) => state.openId)
  const [lens, setLens] = useState<WorkLens>(openId ? 'documents' : 'inbox')
  const session = useSession()
  const owner = session.data?.data.displayName ?? 'You'
  const current = WORK_LENSES.find((item) => item.id === lens) ?? WORK_LENSES[0]
  useEffect(() => {
    if (openId) setLens('documents')
  }, [openId])
  return (
    <section className="work-page" aria-label="Work">
      <div className="work-lenses" role="tablist" aria-label="Work views">
        {WORK_LENSES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="work-lens"
            aria-selected={item.id === lens}
            onClick={() => {
              if (item.id === 'documents') useDocuments.getState().open(null)
              setLens(item.id)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="work-lens-body" role="tabpanel">
        {lens === 'documents' ? (
          <DocumentsExperience roomId={roomId} owner={owner} />
        ) : lensCount(lens) === 0 ? (
          <p className="work-empty">{current.empty}</p>
        ) : null}
      </div>
    </section>
  )
}

export function CalendarPage() {
  return (
    <section className="work-page" aria-label="Calendar">
      {calendar.length === 0 && <p className="work-empty">Nothing scheduled.</p>}
    </section>
  )
}
