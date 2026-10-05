import { useState } from 'react'
import { calendar, lensCount, WORK_LENSES, type WorkLens } from './sections'

export function WorkPage() {
  const [lens, setLens] = useState<WorkLens>('inbox')
  const current = WORK_LENSES.find((item) => item.id === lens) ?? WORK_LENSES[0]
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
            onClick={() => setLens(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="work-lens-body" role="tabpanel">
        {lensCount(current.id) === 0 && <p className="work-empty">{current.empty}</p>}
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
