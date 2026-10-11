import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * Inline editing for the company page: the value reads as plain content; owners and
 * admins click (or Enter) to edit in place. Enter or leaving the field saves, Escape
 * cancels. Empty fields are hidden from people who can't edit them, and show a quiet
 * "Add …" prompt to people who can.
 */
type SaveResult = Promise<boolean>

export function InlineText({ value, canEdit, prompt, label, multiline, maxLength, required, validate, onSave, className, children }: {
  value: string | null
  canEdit: boolean
  /** Shown to editors when empty, e.g. "Add a location". */
  prompt: string
  /** Accessible name of the field. */
  label: string
  multiline?: boolean
  maxLength?: number
  /** Refuse to save an empty value. */
  required?: boolean
  /** Returns an error to show instead of saving. */
  validate?: (next: string) => string | null
  onSave: (next: string | null) => SaveResult
  className?: string
  /** Custom read-only rendering of a non-empty value. */
  children?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) field.current?.focus()
  }, [editing])

  if (!editing) {
    if (!value && !canEdit) return null
    if (!canEdit) return <span className={className}>{children ?? value}</span>
    return (
      <button
        type="button"
        className={`inline-value${value ? '' : ' inline-prompt'}${className ? ` ${className}` : ''}`}
        aria-label={value ? `${label}: ${value}. Edit` : prompt}
        onClick={() => { setDraft(value ?? ''); setError(''); setEditing(true) }}
      >
        {value ? (children ?? value) : prompt}
      </button>
    )
  }

  const commit = async () => {
    const next = draft.trim()
    if (next === (value ?? '')) { setEditing(false); return }
    const problem = next ? validate?.(next) : required ? `${label} can’t be empty` : null
    if (problem) { setError(problem); field.current?.focus(); return }
    setSaving(true)
    const ok = await onSave(next || null)
    setSaving(false)
    if (ok) setEditing(false)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit() }
  }
  const shared = {
    ref: field,
    value: draft,
    maxLength,
    disabled: saving,
    'aria-label': label,
    'aria-invalid': error ? true : undefined,
    className: `inline-field${className ? ` ${className}` : ''}`,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); setError('') },
    onKeyDown: keys,
    onBlur: () => void commit(),
  }
  return (
    <span className="inline-editing">
      {multiline ? <textarea rows={3} {...shared} /> : <input {...shared} />}
      {error && <span className="inline-error" role="alert">{error}</span>}
    </span>
  )
}

export function InlineSelect({ value, options, canEdit, prompt, label, onSave, className }: {
  value: string | null
  options: { value: string; label: string }[]
  canEdit: boolean
  prompt: string
  label: string
  onSave: (next: string | null) => SaveResult
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const select = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (editing) select.current?.focus()
  }, [editing])
  const shown = options.find((o) => o.value === value)?.label ?? null
  if (!editing) {
    if (!shown && !canEdit) return null
    if (!canEdit) return <span className={className}>{shown}</span>
    return (
      <button type="button" className={`inline-value${shown ? '' : ' inline-prompt'}${className ? ` ${className}` : ''}`} aria-label={shown ? `${label}: ${shown}. Edit` : prompt} onClick={() => setEditing(true)}>
        {shown ?? prompt}
      </button>
    )
  }
  return (
    <select
      ref={select}
      className={`inline-field inline-select${className ? ` ${className}` : ''}`}
      aria-label={label}
      value={value ?? ''}
      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
      onBlur={() => setEditing(false)}
      onChange={(e) => { void onSave(e.target.value || null).then(() => setEditing(false)) }}
    >
      <option value="">Not set</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function InlineList({ items, canEdit, prompt, label, addLabel, max = 12, validate, render, onSave }: {
  items: { value: string; suggested: boolean }[]
  canEdit: boolean
  prompt: string
  label: string
  addLabel: string
  max?: number
  validate?: (next: string) => string | null
  /** Custom chip content (e.g. a link). */
  render?: (value: string) => ReactNode
  onSave: (next: string[]) => SaveResult
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const values = items.map((i) => i.value)
  const suggested = items.some((i) => i.suggested)

  useEffect(() => {
    if (adding) input.current?.focus()
  }, [adding])

  if (!items.length && !canEdit) return null

  const write = async (next: string[]) => {
    setSaving(true)
    const ok = await onSave(next)
    setSaving(false)
    return ok
  }
  const add = async () => {
    const next = draft.trim()
    if (!next) { setAdding(false); return }
    if (values.includes(next)) { setDraft(''); return }
    const problem = validate?.(next)
    if (problem) { setError(problem); return }
    if (await write([...values, next])) { setDraft(''); input.current?.focus() }
  }

  return (
    <div className="inline-list" aria-label={label} role="group" aria-busy={saving || undefined}>
      {items.map((item) => (
        <span key={item.value} className="inline-chip" data-suggested={item.suggested || undefined}>
          <span className="inline-chip-text">{render ? render(item.value) : item.value}</span>
          {canEdit && (
            <button type="button" className="inline-chip-remove" aria-label={`Remove ${item.value}`} disabled={saving} onClick={() => void write(values.filter((v) => v !== item.value))}>
              ×
            </button>
          )}
        </span>
      ))}
      {canEdit && !adding && items.length < max && (
        <button type="button" className={`inline-add${items.length ? '' : ' inline-prompt'}`} onClick={() => { setError(''); setAdding(true) }}>
          {items.length ? `+ ${addLabel}` : prompt}
        </button>
      )}
      {adding && (
        <span className="inline-editing">
          <input
            ref={input}
            className="inline-field inline-chip-input"
            value={draft}
            maxLength={500}
            disabled={saving}
            aria-label={addLabel}
            aria-invalid={error ? true : undefined}
            onChange={(e) => { setDraft(e.target.value); setError('') }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void add() }
              if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setDraft('') }
            }}
            onBlur={() => { if (!draft.trim()) setAdding(false) }}
          />
          {error && <span className="inline-error" role="alert">{error}</span>}
        </span>
      )}
      {canEdit && suggested && (
        <span className="inline-suggested">
          Dashed items were suggested by the assistant.{' '}
          <button type="button" className="inline-link" disabled={saving} onClick={() => void write(values)}>Keep them</button>
        </span>
      )}
    </div>
  )
}
