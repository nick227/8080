import { useEffect, useState } from 'react'

/** Pending → Saved → clear, with a sticky error until the next attempt. */
export function useSaveFeedback(pending: boolean, error: Error | null) {
  const [label, setLabel] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (pending) {
      setLabel('Saving…')
      setFailed(false)
      return
    }
    if (error) {
      setLabel(error.message || 'Could not save. Try again.')
      setFailed(true)
      return
    }
    setLabel((current) => (current === 'Saving…' ? 'Saved' : current))
  }, [pending, error])
  useEffect(() => {
    if (label !== 'Saved') return
    const clear = window.setTimeout(() => setLabel(''), 1600)
    return () => window.clearTimeout(clear)
  }, [label])
  return { label, failed }
}
