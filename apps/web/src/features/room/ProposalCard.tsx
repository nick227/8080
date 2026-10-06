import { useEffect, useRef, useState } from 'react'
import type { Proposal } from '@project/sdk'

// One proposal (doc/13 §5), rendered from the server row — the same object a record
// page shows. Before → after, then the buttons its state allows. The server decides;
// `canDecide` only hides buttons it would refuse.
export type ProposalAct = 'apply' | 'dismiss' | 'undo' | 'revert' | 'refresh'
export type ProposalView = { proposal: Proposal; canDecide: boolean; onAct: (action: ProposalAct) => Promise<Proposal> }

const errorOf = (e: unknown) => {
  const code = (e as { code?: string })?.code
  if (code === 'PROPOSAL_UNDO_STALE') return 'stale'
  if (code === 'PROPOSAL_EXPIRED') return 'expired'
  return e instanceof Error ? e.message : 'That didn’t go through — try again'
}

export function ProposalCard({ proposal, canDecide, onAct }: ProposalView) {
  // The stream brings the new state within a second; show the answer at once.
  const [shown, setShown] = useState(proposal)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  // Once Undo is known to be stale it stays so for this card (the record moved on).
  const [stale, setStale] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => { setShown(proposal) }, [proposal])

  const act = async (action: ProposalAct) => {
    setBusy(true)
    setProblem(undefined)
    try {
      const next = await onAct(action)
      if (action !== 'revert' && action !== 'refresh') setShown(next) // those create a new card
    } catch (e) {
      const why = errorOf(e)
      if (why === 'expired') setShown({ ...shown, status: 'expired' })
      if (why === 'stale') setStale(true)
      else setProblem(why)
    } finally {
      setBusy(false)
      card.current?.focus() // focus returns to the card after the action (doc/13 §8)
    }
  }

  const who = shown.decidedBy ?? 'someone'
  // One row whose label the title already names: don't say it twice.
  const single = shown.diff.length === 1 && shown.title.endsWith(shown.diff[0]!.label)
  return (
    <div className="room-proposal" data-status={shown.status} ref={card} tabIndex={-1} aria-busy={busy || undefined}>
      <p className="room-proposal-title">{shown.title}</p>
      {shown.diff.map((row) => (
        <div key={row.label} className="room-proposal-row">
          {!single && <span className="room-proposal-label">{row.label}</span>}
          <span className="room-proposal-before">{row.before || '—'}</span>
          <span className="room-proposal-arrow" aria-hidden>↓</span>
          <span className="room-proposal-after">{row.after || '—'}</span>
        </div>
      ))}
      <div className="room-proposal-actions">
        {shown.status === 'pending' && (canDecide ? (
          <>
            <button type="button" disabled={busy} onClick={() => void act('apply')}>Apply</button>
            <button type="button" disabled={busy} onClick={() => void act('dismiss')}>Not now</button>
          </>
        ) : <p className="room-proposal-note">Waiting for an owner or admin to apply it.</p>)}
        {shown.status === 'applied' && (
          <>
            <p className="room-proposal-note">Applied by {who}.</p>
            {canDecide && !stale && <button type="button" disabled={busy} onClick={() => void act('undo')}>Undo</button>}
          </>
        )}
        {shown.status === 'expired' && (
          <>
            <p className="room-proposal-note">This changed since it was proposed.</p>
            <button type="button" disabled={busy} onClick={() => void act('refresh')}>Refresh</button>
          </>
        )}
        {shown.status === 'dismissed' && <p className="room-proposal-note">Dismissed by {who}.</p>}
        {shown.status === 'undone' && <p className="room-proposal-note">Undone by {who}.</p>}
      </div>
      {stale && shown.status === 'applied' && (
        <div className="room-proposal-actions">
          <p className="room-proposal-note" data-error>It has changed since. Undoing now would reverse newer work.</p>
          <button type="button" disabled={busy} onClick={() => void act('revert')}>Propose putting it back</button>
        </div>
      )}
      {problem && problem !== 'expired' && <p className="room-proposal-note" data-error>{problem}</p>}
    </div>
  )
}
