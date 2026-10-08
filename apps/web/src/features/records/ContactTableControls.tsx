import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CONTACT_FIELD_DEFAULTS, CONTACT_MILESTONES } from '@project/shared'
import { useContactFields, useSession, useWorkspaceMembers } from '@project/sdk'
import { STAGES, titleCase } from './labels'
import { BASE_COLUMNS, columnsFor, readContactPreference, saveContactPreference, sortLabel } from './contactTableModel'
import type { CollectionLayout } from './collectionLayout'

const VIEW_KEYS = ['q', 'owner', 'stage', 'focus', 'status', 'milestone', 'checked', 'sort', 'dir', 'thenSort', 'thenDir']
type SavedView = { id: string; name: string; params: Record<string, string>; columns: string[]; layout: CollectionLayout }
const cleanParams = (params: URLSearchParams) => Object.fromEntries(VIEW_KEYS.map(key => [key, params.get(key) ?? '']))
function readViews(key: string) {
  const stored = readContactPreference<unknown>(key, [])
  return Array.isArray(stored) ? stored.filter((view): view is SavedView => view && typeof view.id === 'string' && typeof view.name === 'string' && view.params && typeof view.params === 'object' && Object.values(view.params).every(v => typeof v === 'string') && Array.isArray(view.columns) && view.columns.every((c: unknown) => typeof c === 'string') && ['list', 'grid'].includes(view.layout)) : []
}

export function ToolbarPanel({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const node = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (node.current && !node.current.contains(e.target as Node)) node.current.open = false }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  return <details ref={node} className={`contact-toolbar-panel ${className}`} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); if (node.current) { node.current.open = false; node.current.querySelector('summary')?.focus() } }
  }}><summary>{label}</summary><div className="contact-panel-body">{children}</div></details>
}

export function ContactViewPicker({
  workspaceId,
  preferenceKey,
  params,
  columns,
  onColumns,
  onFilters,
  layout,
  onLayout,
}: {
  workspaceId: string
  preferenceKey: string
  params: URLSearchParams
  columns: string[]
  onColumns: (columns: string[]) => void
  onFilters: (patch: Record<string, string>) => void
  layout: CollectionLayout
  onLayout: (layout: CollectionLayout) => void
}) {
  const members = useWorkspaceMembers(workspaceId)
  const session = useSession()
  const storageKey = `${preferenceKey}:views`
  const [views, setViews] = useState<SavedView[]>(() => readViews(storageKey))
  const [name, setName] = useState('')
  const [viewMessage, setViewMessage] = useState('')
  useEffect(() => { setViews(readViews(storageKey)) }, [storageKey])
  const storeViews = (next: SavedView[]) => { setViews(next); saveContactPreference(storageKey, next) }
  const mine = members.data?.find(m => m.user.id === session.data?.data.id)?.id
  const apply = (view: Pick<SavedView, 'params' | 'columns' | 'layout'>) => {
    onFilters({ ...Object.fromEntries(VIEW_KEYS.map(key => [key, ''])), status: 'active', sort: 'followUp', dir: 'asc', ...view.params })
    onColumns(view.columns); onLayout(view.layout)
  }
  const preset = (paramsPatch: Record<string, string>) => apply({ params: paramsPatch, columns: BASE_COLUMNS, layout: 'list' })
  const savedMatch = views.find(view => VIEW_KEYS.every(key => (view.params[key] ?? '') === (params.get(key) ?? '')) && JSON.stringify(view.columns) === JSON.stringify(columns) && view.layout === layout)
  const focusLabels: Record<string, string> = { due: 'Due today', overdue: 'Overdue', unassigned: 'Unassigned', neverContacted: 'New outreach', waitingOnUs: 'Waiting on us', needsProposal: 'Ready for proposal' }
  const viewLabel = savedMatch?.name ?? (params.get('status') === 'archived' ? 'Archived' : params.get('owner') === mine && params.get('sort') === 'followUp' ? 'My follow-ups' : focusLabels[params.get('focus') ?? ''] ?? 'All contacts')

  return (
    <ToolbarPanel label={`View · ${viewLabel}`} className="contact-view-picker">
      <div className="contact-view-list">
        <button onClick={() => preset({})}>All contacts</button>
        <button disabled={!mine} onClick={() => preset({ owner: mine!, sort: 'followUp' })}>My follow-ups</button>
        <button onClick={() => preset({ focus: 'neverContacted', sort: 'name' })}>New outreach</button>
        <button onClick={() => preset({ focus: 'needsProposal', sort: 'potentialValue', dir: 'desc' })}>Ready for proposal</button>
        {views.map(view => <div key={view.id}><button onClick={() => apply(view)}>{view.name}</button><button aria-label={`Delete view ${view.name}`} onClick={() => storeViews(views.filter(v => v.id !== view.id))}>×</button></div>)}
      </div>
      <form onSubmit={e => {
        e.preventDefault()
        if (!name.trim()) return
        const existing = views.find(v => v.name.toLowerCase() === name.trim().toLowerCase())
        if (existing) { setViewMessage('Choose a different name, or delete the existing view first.'); return }
        storeViews([...views, { id: crypto.randomUUID(), name: name.trim(), params: cleanParams(params), columns, layout }])
        setViewMessage(`Saved “${name.trim()}” on this browser.`); setName('')
      }}>
        <label>Save this view<input aria-label="View name" maxLength={60} value={name} onChange={e => { setName(e.target.value); setViewMessage('') }} placeholder="e.g. My weekly outreach" /></label>
        <button disabled={!name.trim()}>Save view</button>
        {viewMessage && <small role="status">{viewMessage}</small>}
      </form>
    </ToolbarPanel>
  )
}

export function ContactColumnPicker({
  workspaceId,
  columns,
  onColumns,
  layout,
  onLayout,
}: {
  workspaceId: string
  columns: string[]
  onColumns: (columns: string[]) => void
  layout: CollectionLayout
  onLayout: (layout: CollectionLayout) => void
}) {
  const fields = useContactFields(workspaceId)
  const definitions = fields.data ?? CONTACT_FIELD_DEFAULTS
  return (
    <ToolbarPanel label="Columns" className="contact-column-picker">
      {columnsFor(definitions).map(c => <label className="contact-column-option" key={c.key}><input type="checkbox" checked={columns.includes(c.key)} onChange={e => onColumns(e.target.checked ? [...columns, c.key] : columns.filter(k => k !== c.key))} />{c.label}</label>)}
      <button onClick={() => onColumns(BASE_COLUMNS)}>Reset columns</button>
    </ToolbarPanel>
  )
}

export function ContactFilterChips({
  params,
  onFilters,
}: {
  params: URLSearchParams
  onFilters: (patch: Record<string, string>) => void
}) {
  const focusLabels: Record<string, string> = { due: 'Due today', overdue: 'Overdue', unassigned: 'Unassigned', neverContacted: 'New outreach', waitingOnUs: 'Waiting on us', needsProposal: 'Ready for proposal' }
  const active = [
    params.get('q') ? { key: 'q', label: `Search: ${params.get('q')}` } : null,
    params.get('owner') ? { key: 'owner', label: 'Owner set' } : null,
    params.get('stage') ? { key: 'stage', label: `Stage: ${titleCase(params.get('stage')!)}` } : null,
    params.get('focus') ? { key: 'focus', label: focusLabels[params.get('focus')!] ?? params.get('focus')! } : null,
    params.get('status') === 'archived' ? { key: 'status', label: 'Archived' } : null,
  ].filter((v): v is { key: string; label: string } => !!v)

  if (!active.length) return null

  return (
    <div className="contact-filter-chips" aria-label="Active filters">
      {active.map(item => (
        <button key={item.key} aria-label={`Remove ${item.label}`} onClick={() => onFilters({ [item.key]: item.key === 'status' ? 'active' : '' })}>
          {item.label} <span aria-hidden="true">×</span>
        </button>
      ))}
      <button onClick={() => onFilters({ q: '', owner: '', stage: '', focus: '', status: 'active' })}>Clear filters</button>
    </div>
  )
}

export function ContactTableControls(props: {
  workspaceId: string; preferenceKey: string; columns: string[]; onColumns: (columns: string[]) => void
  params: URLSearchParams; onFilters: (patch: Record<string, string>) => void
  layout: CollectionLayout; onLayout: (layout: CollectionLayout) => void
}) {
  return null
}

