import { useState } from 'react'
import { useContactBrief, useGenerateBrief, type BriefClaim, type BriefEvidence, type ContactBrief as Brief } from '@project/sdk'
import './brief.css'

// "Brief me" (doc/13 D3): read-only intelligence at the top of a contact. Facts cite
// numbered evidence that opens in place; the suggested next step is shown apart, as
// an inference. A stale brief says so instead of passing as current. No record is
// changed from here.
const SECTIONS: [keyof Pick<Brief, 'summary' | 'need' | 'recent' | 'commitments' | 'openQuestions'>, string][] = [
  ['summary', 'Who'],
  ['need', 'What they want'],
  ['recent', 'What happened'],
  ['commitments', 'Promised'],
  ['openQuestions', 'Missing'],
]
const at = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Evidence({ item, n }: { item: BriefEvidence; n: number }) {
  const link = item.link && 'type' in item.link ? item.link : null
  return (
    <div className="brief-evidence" id={`brief-ev-${n}`}>
      <p className="brief-evidence-head">[{n}] {item.title}{item.when ? ` · ${item.when}` : ''}</p>
      <p className="brief-evidence-text">{item.text}</p>
      {link?.type === 'room' && link.roomId && <a href={`/room/${link.roomId}`}>Open conversation</a>}
    </div>
  )
}

function Claims({ claims, numberOf, open, toggle }: { claims: BriefClaim[]; numberOf: Map<string, number>; open: Set<string>; toggle: (id: string) => void }) {
  return (
    <ul className="brief-claims">
      {claims.map((c, i) => (
        <li key={i}>
          <span>{c.text}</span>
          {c.evidence.map((id) => (
            <button key={id} type="button" className="brief-cite" aria-expanded={open.has(id)} aria-controls={`brief-ev-${numberOf.get(id)}`} onClick={() => toggle(id)}>
              {numberOf.get(id)}
            </button>
          ))}
        </li>
      ))}
    </ul>
  )
}

export function ContactBrief({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const brief = useContactBrief(workspaceId, contactId)
  const generate = useGenerateBrief(workspaceId, contactId)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const data = brief.data
  const busy = generate.isPending

  if (brief.isLoading) return <section className="brief" aria-busy="true"><div className="brief-placeholder" /></section>
  if (!data) {
    return (
      <section className="brief" aria-busy={busy || undefined}>
        <div className="brief-bar">
          <h2>Brief</h2>
          <button type="button" className="record-primary" disabled={busy} onClick={() => generate.mutate()}>{busy ? 'Reading…' : 'Brief me'}</button>
        </div>
        {busy ? <div className="brief-placeholder" /> : <p className="brief-muted">What to know before you contact them, from their records, notes and conversations.</p>}
        {generate.error && <p className="brief-error">{generate.error.message}</p>}
      </section>
    )
  }

  const numberOf = new Map(data.evidence.map((e, i) => [e.id, i + 1]))
  const shown = data.evidence.filter((e) => open.has(e.id))
  return (
    <section className="brief" aria-busy={busy || undefined} data-stale={data.stale || undefined}>
      <div className="brief-bar">
        <h2>Brief</h2>
        <button type="button" disabled={busy} onClick={() => generate.mutate()}>{busy ? 'Reading…' : 'Refresh'}</button>
      </div>
      {data.stale && <p className="brief-stale" role="status">Things changed since this brief. Refresh it before relying on it.</p>}
      {SECTIONS.filter(([k]) => data[k].length).map(([k, label]) => (
        <div key={k} className="brief-section">
          <h3>{label}</h3>
          <Claims claims={data[k]} numberOf={numberOf} open={open} toggle={toggle} />
        </div>
      ))}
      {shown.length > 0 && <div className="brief-sources">{shown.map((e) => <Evidence key={e.id} item={e} n={numberOf.get(e.id)!} />)}</div>}
      {data.nextStep && (
        <div className="brief-next">
          <h3>Suggested next step <span>· a suggestion, not a record</span></h3>
          <p>
            {data.nextStep.text}
            {data.nextStep.basis.map((id) => (
              <button key={id} type="button" className="brief-cite" aria-expanded={open.has(id)} onClick={() => toggle(id)}>{numberOf.get(id)}</button>
            ))}
          </p>
        </div>
      )}
      <p className="brief-muted brief-foot">{data.generator === 'ai' ? `Drafted from ${data.evidence.length} sources` : 'From the records'} · {at(data.generatedAt)}</p>
      {generate.error && <p className="brief-error">{generate.error.message}</p>}
    </section>
  )
}
