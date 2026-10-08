import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ResultContext } from './navigation'

export function useNarrowRecords(container: RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760)
  useEffect(() => {
    const node = container.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= 760))
    observer.observe(node)
    return () => observer.disconnect()
  }, [container])
  return narrow
}

export function RecordMedia({
  name,
  src,
  person = false,
}: {
  name: string
  src?: string | null
  person?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <span className={`record-media${person ? ' record-avatar' : ''}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">
          {name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0])
            .join('')
            .toUpperCase()}
        </span>
      )}
    </span>
  )
}

export function RecordStepper({
  id,
  results,
  busy,
  hasMore,
  onStep,
  onLoad,
}: {
  id: string
  results?: ResultContext
  busy?: boolean
  hasMore?: boolean
  onStep: (id: string) => void
  onLoad: () => void
}) {
  const index = results?.ids.indexOf(id) ?? -1
  if (!results || index < 0) return null
  const next = results.ids[index + 1]
  return (
    <div className="record-stepper" role="group" aria-label="Record navigation">
      <span aria-live="polite">
        {index + 1} of {results.ids.length}
        {!results.complete && ' loaded'}
      </span>
      <button
        type="button"
        disabled={index === 0 || busy}
        onClick={() => onStep(results.ids[index - 1])}
        title="Previous record"
      >
        ← Previous
      </button>
      <button
        type="button"
        disabled={busy || (!next && !hasMore)}
        onClick={() => (next ? onStep(next) : onLoad())}
        title={next ? 'Next record' : 'Load more results'}
      >
        {busy ? 'Loading…' : next ? 'Next →' : hasMore ? 'Load more →' : 'Next →'}
      </button>
    </div>
  )
}

export function RecordPreviewPanel({
  children,
  title,
  onClose,
  onBack,
  backLabel,
  onExpand,
  navigation,
  narrow,
  recordKey,
}: {
  children: ReactNode
  title: string
  onClose: () => void
  onBack?: () => void
  backLabel?: string
  onExpand: () => void
  navigation?: ReactNode
  narrow: boolean
  recordKey: string
}) {
  const panel = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    content.current?.scrollTo(0, 0)
  }, [recordKey])
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    const escape = (event: KeyboardEvent) => {
      // A form dialog or composer owns Escape while it is open.
      if (event.key === 'Escape' && !document.querySelector('dialog[open], .compose-overlay')) {
        event.preventDefault()
        close.current()
      }
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('keydown', escape)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  return (
    <aside
      className="record-preview"
      ref={panel}
      tabIndex={-1}
      role={narrow ? 'dialog' : 'region'}
      aria-modal={narrow || undefined}
      aria-label={`${title} preview`}
      onKeyDown={(event) => {
        if (!narrow || event.key !== 'Tab') return
        const controls = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
          ) ?? [],
        ).filter((node) => node.getClientRects().length > 0)
        const first = controls[0],
          last = controls.at(-1)
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === panel.current)
        ) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <div className="record-preview-tools">
        {onBack ? <button onClick={onBack}>← {backLabel}</button> : <span>Quick preview</span>}
        <button onClick={onExpand}>Open full record ↗</button>
        <button onClick={onClose} aria-label="Close preview">
          ✕
        </button>
      </div>
      {navigation}
      <div className="record-preview-content" ref={content}>
        {children}
      </div>
    </aside>
  )
}

export { FormSlideout as RecordFormDialog } from '../work/FormSlideout'
