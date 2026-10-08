import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { audienceRules, type AudienceFilters, type RecipientConfig } from '@project/shared'
import { useAudiencePreview, useContactFields, useContacts, useTags, useWorkspaceMembers, useWorkspaceVocabulary } from '@project/sdk'
import { FormSlideout } from '../work/FormSlideout'

export function AudienceEditor({ workspaceId, config, count, editable, save }: { workspaceId: string; config: RecipientConfig | null; count: number; editable: boolean; save: (config: RecipientConfig | null) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const vocabulary = useWorkspaceVocabulary(workspaceId)
  const members = useWorkspaceMembers(workspaceId)
  const fields = useContactFields(workspaceId)
  const labels = Object.fromEntries([...(vocabulary.data?.stages ?? []).map(s => [s.key, s.label]), ...(members.data ?? []).map(m => [m.id, m.user.name || m.email || m.id]), ...(fields.data ?? []).map(f => [f.key, f.label])])
  const navigate = useNavigate()
  const location = useLocation()
  const intrinsic = config?.source === 'WORKSPACE_MEMBERS' || config?.source === 'TRIGGER_CONTACT'
  const commit = async (next: RecipientConfig | null) => { setError(''); try { await save(next) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save audience'); throw e } }
  const remove = (key: string) => {
    if (!config) return
    let next: RecipientConfig | null = null
    if (config.source === 'CONTACTS' && key !== 'all') {
      const filters = { ...config.filters }
      if (key.startsWith('attribute:')) { filters.attributes = filters.attributes?.filter((_, i) => i !== Number(key.split(':')[1])); if (!filters.attributes?.length) delete filters.attributes }
      else delete filters[key as keyof AudienceFilters]
      // Removing the last rule clears TO; it never silently expands to all contacts.
      if (Object.keys(filters).length) next = { source: 'CONTACTS', filters }
    }
    void commit(next).catch(() => undefined)
  }
  return <div className="agents-field"><span className="agents-field-name">TO</span><div>
    <div className="audience-chips">{audienceRules(config, labels).map(rule => <span className="audience-chip" key={rule.key}>
      <button type="button" disabled={!editable || intrinsic} onClick={() => setOpen(true)}>{rule.label}</button>
      {editable && !intrinsic && <button type="button" aria-label={`Remove ${rule.label}`} onClick={() => remove(rule.key)}>×</button>}
    </span>)}
    {editable && !intrinsic && <button type="button" className="agents-link" onClick={() => setOpen(true)}>{config ? '+ Edit audience' : '+ Add recipients'}</button>}</div>
    {config && config.source !== 'TRIGGER_CONTACT' && <p className="audience-count">{count} {config.source === 'WORKSPACE_MEMBERS' ? 'people' : 'unique recipients'}{!intrinsic && <> · <button type="button" className="agents-link" onClick={() => navigate({ pathname: location.pathname, search: new URLSearchParams({ desk: 'contacts', audience: JSON.stringify(config) }).toString() })}>View contacts →</button></>}</p>}
    {error && <p role="alert">{error}</p>}
    {open && <AudienceModal workspaceId={workspaceId} initial={config} onClose={() => setOpen(false)} onSave={async next => { await commit(next); setOpen(false) }} />}
  </div></div>
}

function AudienceModal({ workspaceId, initial, onClose, onSave }: { workspaceId: string; initial: RecipientConfig | null; onClose: () => void; onSave: (config: RecipientConfig) => Promise<void> }) {
  const [mode, setMode] = useState<'CONTACTS' | 'SELECTED_CONTACTS'>(initial?.source === 'SELECTED_CONTACTS' ? 'SELECTED_CONTACTS' : 'CONTACTS')
  const [filters, setFilters] = useState<AudienceFilters>(initial?.filters ?? {})
  const [ids, setIds] = useState<string[]>(initial?.ids ?? [])
  const [q, setQ] = useState('')
  const [all, setAll] = useState(initial?.source === 'CONTACTS' && Object.keys(initial.filters ?? {}).length === 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const tags = useTags(workspaceId)
  const vocabulary = useWorkspaceVocabulary(workspaceId)
  const members = useWorkspaceMembers(workspaceId)
  const fields = useContactFields(workspaceId)
  const contacts = useContacts(workspaceId, { q: q.trim() || undefined, limit: 50 })
  const candidate: RecipientConfig | null = mode === 'SELECTED_CONTACTS' ? ids.length ? { source: mode, ids } : null : Object.keys(filters).length || all ? { source: mode, filters } : null
  const [debounced, setDebounced] = useState(candidate)
  const serialized = JSON.stringify(candidate)
  useEffect(() => { const timer = setTimeout(() => setDebounced(candidate), 250); return () => clearTimeout(timer) }, [serialized])
  const preview = useAudiencePreview(workspaceId, debounced)
  const current = JSON.stringify(debounced) === serialized
  const set = (key: keyof AudienceFilters, value: unknown) => setFilters(prev => { const next = { ...prev, [key]: value }; if (value === undefined || (Array.isArray(value) && !value.length)) delete next[key]; return next })
  const select = (label: string, key: 'categories' | 'stages' | 'tags' | 'assignedTo', options: { value: string; label: string }[]) => <label>{label}<select aria-label={label} multiple value={filters[key] ?? []} onChange={e => set(key, Array.from(e.target.selectedOptions, o => o.value))}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
  return <FormSlideout title="Add recipients" onClose={onClose}><form className="audience-form" onSubmit={async e => { e.preventDefault(); if (!candidate) return; setSaving(true); setError(''); try { await onSave(candidate) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save audience') } finally { setSaving(false) } }}>
    <label>Recipient mode<select aria-label="Recipient mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="CONTACTS">Contacts matching rules</option><option value="SELECTED_CONTACTS">Selected contacts</option></select></label>
    {mode === 'CONTACTS' ? <>
      <p>Match every rule below. Multiple values within a field match any value.</p>
      {select('Category', 'categories', (tags.data ?? []).map(t => ({ value: t.name, label: t.name })))}
      {select('Pipeline', 'stages', (vocabulary.data?.stages ?? []).filter(s => !s.archived).map(s => ({ value: s.key, label: s.label })))}
      <label>Location<input value={filters.location?.join(', ') ?? ''} placeholder="Austin" onChange={e => set('location', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></label>
      {select('Tags', 'tags', (tags.data ?? []).map(t => ({ value: t.name, label: t.name })))}
      {select('Assigned to', 'assignedTo', (members.data ?? []).filter(m => m.status === 'active').map(m => ({ value: m.id, label: m.user.name || m.email || m.id })))}
      <label>Has email<select value={filters.hasEmail === undefined ? '' : String(filters.hasEmail)} onChange={e => set('hasEmail', e.target.value === '' ? undefined : e.target.value === 'true')}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></label>
      {(filters.attributes ?? []).map((a, i) => <div className="audience-attribute" key={i}>
        <select aria-label="Attribute" value={a.field} onChange={e => set('attributes', filters.attributes!.map((v, j) => j === i ? { field: e.target.value, op: 'eq', value: '' } : v))}>{[...(fields.data ?? []).filter(f => !f.archived).map(f => ({ value: f.key, label: f.label })), { value: 'createdAt', label: 'Created date' }, { value: 'lastActivityAt', label: 'Last activity' }].map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
        <select aria-label="Comparison" value={a.op} onChange={e => set('attributes', filters.attributes!.map((v, j) => j === i ? { ...v, op: e.target.value } : v))}><option value="eq">Equals</option><option value="gte">At least / on or after</option><option value="lte">At most / on or before</option><option value="before_days">Not in the last N days</option></select>
        <input aria-label="Value" value={String(a.value)} onChange={e => { const type = fields.data?.find(f => f.key === a.field)?.type; const value = a.op === 'before_days' || type === 'number' ? Number(e.target.value) : type === 'checkbox' ? e.target.value === 'true' : e.target.value; set('attributes', filters.attributes!.map((v, j) => j === i ? { ...v, value } : v)) }} />
        <button type="button" aria-label="Remove attribute" onClick={() => set('attributes', filters.attributes!.filter((_, j) => j !== i))}>×</button>
      </div>)}
      <button type="button" className="agents-link" onClick={() => set('attributes', [...(filters.attributes ?? []), { field: 'lastContactedAt', op: 'before_days', value: 30 }])}>+ Attribute rule</button>
      {!Object.keys(filters).length && <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Deliberately include all active contacts</label>}
    </> : <>
      <label>Search contacts<input value={q} onChange={e => setQ(e.target.value)} /></label>
      <p>{ids.length} contacts selected <button type="button" onClick={() => setIds([])}>Clear selection</button></p>
      {contacts.data?.pages.flatMap(p => p.data).map(c => <label className="audience-person" key={c.id}><input type="checkbox" checked={ids.includes(c.id)} onChange={e => setIds(e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />{c.displayName} <small>{c.primaryEmail || 'No email'}</small></label>)}
      {contacts.hasNextPage && <button type="button" disabled={contacts.isFetchingNextPage} onClick={() => void contacts.fetchNextPage()}>Load more contacts</button>}
    </>}
    <div aria-live="polite">{!candidate ? 'Choose recipients to see matches.' : !current || preview.isFetching ? 'Counting contacts…' : preview.isError ? 'Could not resolve these rules. Check the attribute type and value.' : `${preview.data?.recipientCount ?? 0} unique recipients (${preview.data?.matchedCount ?? 0} contact matches)`}</div>
    {preview.data && current && <p>{preview.data.contacts.slice(0, 5).map(c => c.name).join(', ')}</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="agents-button" disabled={saving || !candidate || !current || preview.isFetching || !preview.data || preview.isError}>{saving ? 'Saving…' : `Add ${current ? preview.data?.recipientCount ?? 0 : '…'}`}</button></footer>
  </form></FormSlideout>
}
