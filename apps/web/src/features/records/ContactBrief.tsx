import { useContactBrief, useGenerateBrief, type ContactBrief as Brief } from '@project/sdk'
import './brief.css'

const SECTIONS: [keyof Pick<Brief, 'summary' | 'need' | 'recent' | 'commitments' | 'openQuestions'>, string][] = [
  ['summary', 'Who'],
  ['need', 'What they want'],
  ['recent', 'What happened'],
  ['commitments', 'Promised'],
  ['openQuestions', 'Missing'],
]
const at = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function ContactBrief({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const brief = useContactBrief(workspaceId, contactId)
  const generate = useGenerateBrief(workspaceId, contactId)
  const data = brief.data
  const busy = generate.isPending

  if (brief.isLoading) return <section className="brief" aria-busy="true"><div className="brief-placeholder" /></section>
  if (!data) {
    return (
      <section className="brief" aria-busy={busy || undefined}>
        <div className="brief-bar">
          <h2>Summary</h2>
          <button type="button" className="record-primary" disabled={busy} onClick={() => generate.mutate()}>{busy ? 'Summarizing…' : 'Summarize contact'}</button>
        </div>
        {busy ? <div className="brief-placeholder" /> : <p className="brief-muted">What to know before you contact them, from their records, notes and conversations.</p>}
        {generate.error && <p className="brief-error">{generate.error.message}</p>}
      </section>
    )
  }

  const sectionsWithContent = SECTIONS.filter(([k]) => data[k]?.length > 0)

  return (
    <section className="brief" aria-busy={busy || undefined} data-stale={data.stale || undefined}>
      <div className="brief-bar">
        <h2>Brief</h2>
        <button type="button" disabled={busy} onClick={() => generate.mutate()}>{busy ? 'Summarizing…' : 'Refresh data'}</button>
      </div>
      {data.stale && <p className="brief-stale" role="status">The records have changed since this summary. Refresh it before relying on it.</p>}
      {sectionsWithContent.map(([k, label]) => (
        <div key={k} className="brief-section">
          <h3>{label}</h3>
          <ul className="brief-claims">
            {data[k].map((c, i) => (
              <li key={i}>{c.text}</li>
            ))}
          </ul>
        </div>
      ))}
      {data.nextStep && (
        <div className="brief-next">
          <h3>Suggested next step</h3>
          <p>{data.nextStep.text}</p>
        </div>
      )}
      <p className="brief-muted brief-foot">
        {data.generator === 'ai' ? `Drafted from ${data.evidence.length} sources` : 'From the records'} · {at(data.generatedAt)}
      </p>
      {generate.error && <p className="brief-error">{generate.error.message}</p>}
    </section>
  )
}
