import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { SortDirection } from 'react-data-grid'
import type { CellType } from '@project/shared'

export const ROW_KEY = '__row'

type HeaderProps = {
  name: string
  selected: boolean
  sort: SortDirection | undefined
  editable: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onSort: () => void
  onDelete: () => void
  /** Typed sheets (doc/13 A2): the column's type and its total, when they can change. */
  type?: CellType
  onType?: (type: CellType) => void
  total?: boolean
  onTotal?: () => void
}

const TYPE_LABEL: Record<CellType, string> = { text: 'Text', number: 'Number', money: 'Money', date: 'Date', boolean: 'Yes / no' }

export function SheetHeader({ name, selected, sort, editable, onSelect, onRename, onSort, onDelete, type, onType, total, onTotal }: HeaderProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancel = useRef(false)
  useEffect(() => {
    if (draft === null) return
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('input.work-colname')) return
      onRename(draft)
      setDraft(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [draft, onRename])
  const stop = (event: MouseEvent) => event.stopPropagation()
  const keep = (event: MouseEvent) => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== event.currentTarget) active.blur()
    event.preventDefault()
    event.stopPropagation()
  }

  if (draft !== null) {
    return (
      <div className="work-colhead">
        <input
          className="work-colname"
          aria-label="Column name"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            if (!cancel.current) onRename(event.currentTarget.value)
            cancel.current = false
            setDraft(null)
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              onRename(event.currentTarget.value)
              setDraft(null)
            }
            if (event.key === 'Escape') {
              cancel.current = true
              setDraft(null)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="work-colhead" data-editable={editable || undefined} data-selected={selected || undefined}>
      <button type="button" className="work-colname" onMouseDown={stop} onClick={() => (editable ? setDraft(name) : onSelect())}>{name}</button>
      <button type="button" className="work-colpick" aria-label={`Select ${name}`} onMouseDown={keep} onClick={onSelect} />
      <button type="button" className="work-colsort" aria-label={`Sort ${name}`} data-active={sort || undefined} onMouseDown={keep} onClick={onSort}>
        {sort === 'DESC' ? '↓' : '↑'}
      </button>
      {type && onType && (
        <select className="work-coltype" aria-label={`${name} column type`} value={type} onMouseDown={stop} onClick={stop} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => onType(event.target.value as CellType)}>
          {(Object.keys(TYPE_LABEL) as CellType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      )}
      {onTotal && (type === 'number' || type === 'money') && (
        <button type="button" className="work-coltotal" aria-label={total ? `Hide ${name} total` : `Show ${name} total`} aria-pressed={!!total} onMouseDown={keep} onClick={onTotal}>Σ</button>
      )}
      {editable && <button type="button" className="work-coldel" aria-label={`Delete ${name} column`} onMouseDown={keep} onClick={onDelete}>×</button>}
    </div>
  )
}

export function CornerCell({ onSelect }: { onSelect: () => void }) {
  return <button type="button" className="work-corner" aria-label="Select all" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation() }} onClick={onSelect} />
}
