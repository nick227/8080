import { useState } from 'react'
import type { Choice, ChoiceActions } from '../../api/types'

// A bot's offered choice (doc/12 §4): generic options, one answer. Open → buttons
// (`many` toggles, then Done). Answered → locked, the chosen options marked, and a
// line saying who chose. The click goes to the server as option ids, never as chat.
export type ChoiceView = {
  actions: ChoiceActions
  choice?: Choice
  meId?: string
  onChoose: (optionIds: string[]) => Promise<void>
}

export function ChoiceBar({ actions, choice, meId, onChoose }: ChoiceView) {
  const [picked, setPicked] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const mine = !actions.forUserId || actions.forUserId === meId
  const open = !choice && mine
  const chosen = choice?.optionIds ?? (sending ? picked : [])

  const submit = async (ids: string[]) => {
    setPicked(ids)
    setSending(true)
    setError(undefined)
    try {
      await onChoose(ids)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Didn't go through — try again")
    } finally {
      setSending(false)
    }
  }
  const press = (id: string) => {
    if (!open || sending) return
    if (actions.mode === 'one') void submit([id])
    else setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  const labels = actions.options.filter((o) => chosen.includes(o.id)).map((o) => o.label).join(', ')
  return (
    <div className="room-choice" data-state={choice ? 'chosen' : open ? 'open' : 'waiting'} aria-busy={sending || undefined}>
      <div className="room-choice-options" role="group">
        {actions.options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={chosen.includes(option.id) || (actions.mode === 'many' && picked.includes(option.id))}
            disabled={!open || sending}
            onClick={() => press(option.id)}
          >
            {option.label}
          </button>
        ))}
        {actions.mode === 'many' && open && (
          <button type="button" className="room-choice-done" disabled={sending || picked.length === 0} onClick={() => void submit(picked)}>
            Done
          </button>
        )}
      </div>
      {choice && <p className="room-choice-note">{choice.userId === meId ? 'You chose' : 'Chosen:'} {labels}</p>}
      {!choice && !mine && <p className="room-choice-note">Waiting on someone else</p>}
      {error && <p className="room-choice-note" data-error>{error}</p>}
    </div>
  )
}
