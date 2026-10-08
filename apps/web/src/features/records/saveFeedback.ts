import { useEffect, useRef, useState } from 'react'

/** Pending → Saved → clear, with a sticky error until the next attempt. */
export function useSaveFeedback(pending: boolean, error: Error | null) {
  const [label, setLabel] = useState('')
  const [failed, setFailed] = useState(false)
  const hadError = useRef(false)
  useEffect(() => {
    if (pending) {
      hadError.current = false
      setLabel('Saving…')
      setFailed(false)
      return
    }
    if (error) {
      hadError.current = true
      setLabel(error.message || 'Could not save. Try again.')
      setFailed(true)
      return
    }
    const clearedError = hadError.current
    hadError.current = false
    setFailed(false)
    setLabel((current) => clearedError ? '' : current === 'Saving…' ? 'Saved' : current)
  }, [pending, error])
  useEffect(() => {
    if (label !== 'Saved') return
    const clear = window.setTimeout(() => setLabel(''), 1600)
    return () => window.clearTimeout(clear)
  }, [label])
  return { label, failed }
}
