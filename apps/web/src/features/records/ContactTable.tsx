import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CONTACT_FIELD_DEFAULTS, CONTACT_MILESTONES, CONTACT_MILESTONE_HELP, type ContactFieldDefinition } from '@project/shared'
import { useContactFields, useNotes, useWorkspaceMembers, useWorkspaceVocabulary, type Contact, type UpdateContactInput, type WorkspaceMember } from '@project/sdk'
import { STAGES, dateLabel, followUpLate, localDay, titleCase } from './labels'
import { RecordNotes } from './RecordNotes'
import { RecordFormDialog, RecordMedia } from './RecordChrome'
import { columnsFor, followUpDay, followUpInstant, sortLabel } from './contactTableModel'
import { useContactRowEditor, type ContactUndo } from './useContactRowEditor'
import './contactTable.css'
export { ContactTableControls } from './ContactTableControls'
export { useContactColumns, readContactPreference, saveContactPreference, sortLabel } from './contactTableModel'
export type { ContactUndo } from './useContactRowEditor'

const isMilestone = (key: string): key is typeof CONTACT_MILESTONES[number] => CONTACT_MILESTONES.includes(key as typeof CONTACT_MILESTONES[number])
const useMobile = () => {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const change = () => setMobile(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return mobile
}
type Props = {
  workspaceId: string; currency: string; records: Contact[]; columns: string[]; selected: string[]
  sort: string; dir: string; onSort: (sort: string) => void; onToggle: (id: string) => void
  onSelect: (ids: string[]) => void; href: (id: string) => string
  onOpen: (id: string) => void; onPreview: (id: string, name: string) => void; previewId?: string | null
  onCommitted: (undo: ContactUndo) => void
}
export function ContactUndoBar({ undo, workspaceId, onDismiss }: { undo: ContactUndo | null; workspaceId: string; onDismiss: () => void }) {
  return null
}
export function ContactTable(props: Props) {
  const fields = useContactFields(props.workspaceId)
  const members = useWorkspaceMembers(props.workspaceId)
  const definitions = fields.data ?? CONTACT_FIELD_DEFAULTS
  const columns = columnsFor(definitions).filter(c => props.columns.includes(c.key))
  const mobile = useMobile()
  const scope = props.records.slice(0, 50).map(c => c.id)
  const allSelected = scope.length > 0 && scope.every(id => props.selected.includes(id))
  const selectAll = useRef<HTMLInputElement>(null)
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = props.selected.length > 0 && !allSelected }, [props.selected.length, allSelected])
  const selection = <input ref={selectAll} type="checkbox" aria-label={`Select first ${scope.length} loaded contacts`} checked={allSelected} onChange={() => props.onSelect(allSelected ? [] : scope)} />
  const header = (label: string, key?: string, help?: string) => key ? (
    <button type="button" className="docs-sort" data-active={props.sort === key || undefined} title={help} onClick={() => props.onSort(key)}>
      {label}
      <span className="docs-sort-dir" aria-hidden>{props.sort === key ? (props.dir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </button>
  ) : (
    <span className="docs-sort" title={help}>{label}</span>
  )
  const rows = props.records.map(contact => <ContactTableRow key={contact.id} {...props} contact={contact} definitions={definitions} visible={columns.map(c => c.key)} members={members.data ?? []} mobile={mobile} />)
  if (mobile) return <div className="contact-mobile-workbench">
    <label className="contact-mobile-selection">{selection}Select {scope.length > 1 ? `first ${scope.length}` : 'contact'}<span>Up to 50 at a time</span></label>
    <div className="contact-mobile-list">{rows}</div>
  </div>
  return <div className="docs-table-wrap contact-table-scroll" tabIndex={0} role="region" aria-label="Contact workbench">
    <table className="docs-table contact-table">
      <caption className="record-sr-only">Contacts. Edit fields directly. Select up to 50 loaded contacts at a time.</caption>
      <thead><tr>
        <th className="table-col-check">{selection}</th>
        <th className="contact-name" scope="col" aria-sort={props.sort === 'name' ? props.dir === 'desc' ? 'descending' : 'ascending' : 'none'}>{header('Contact', 'name')}</th>
        {columns.map((c, index) => <th key={c.key} scope="col" className={isMilestone(c.key) ? 'contact-milestone' : `contact-column-${c.key}`} aria-sort={c.sort && props.sort === c.sort ? props.dir === 'desc' ? 'descending' : 'ascending' : undefined}>
          {header(c.key === 'potentialValue' ? `${c.label} (${props.currency})` : c.label, c.sort, isMilestone(c.key) ? CONTACT_MILESTONE_HELP[c.key] : c.key === 'stage' ? 'Current position in the pipeline; completed milestones are recorded separately.' : undefined)}
        </th>)}
        <th scope="col" className="docs-col-action"><span className="docs-sort">Preview</span></th>
      </tr></thead><tbody>{rows}</tbody>
    </table>
  </div>
}

function NotesCountCell({ workspaceId, contactId, contactName, onPreview }: { workspaceId: string; contactId: string; contactName: string; onPreview: (id: string, name: string) => void }) {
  const notesQuery = useNotes(workspaceId, { contactId })
  const rows = notesQuery.data?.pages.flatMap((page) => page.data) ?? []
  const count = notesQuery.data?.pages[0]?.meta?.total ?? rows.length
  return (
    <button
      type="button"
      className="contact-notes-count-btn"
      title="View or add notes in preview"
      onClick={(e) => {
        e.stopPropagation()
        onPreview(contactId, contactName)
      }}
    >
      📝 {count} {count === 1 ? 'note' : 'notes'}
    </button>
  )
}

type RowProps = Props & { contact: Contact; definitions: ContactFieldDefinition[]; visible: string[]; members: WorkspaceMember[]; mobile: boolean }
function ContactTableRow({ contact, definitions, visible, members, mobile, ...props }: RowProps) {
  const editor = useContactRowEditor(contact, props.workspaceId, props.onCommitted)
  const vocabulary = useWorkspaceVocabulary(props.workspaceId)
  const stages = (vocabulary.data?.stages ?? []).filter((s) => !s.archived)
  const stageOptions = stages.length ? stages : STAGES.map((key) => ({ key, label: titleCase(key) }))
  const { current } = editor
  const [notesOpen, setNotesOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const label = (field: string) => `${field} for ${current.displayName}`
  const company = current.accounts.filter(a => !a.endedAt).sort((a,b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name))[0]
  const definition = (key: string) => definitions.find(f => f.key === key)
  const save = (patch: UpdateContactInput) => { void editor.save(patch) }
  const editText = (key: string, value: string | number | null | undefined, type = 'text', maxLength = 255, custom = false) => <CellInput
    label={label(definition(key)?.label ?? sortLabel(key))} value={value == null ? '' : String(value)} type={type} maxLength={maxLength} numberConfig={definition(key)?.numberConfig}
    onSave={value => save(custom ? { fieldValues: { [key]: type === 'number' ? value === '' ? null : Number(value) : value || null } } : { [key]: type === 'number' ? value === '' ? null : Number(value) : value || null })} />
  const fieldCell = (key: string): ReactNode => {
    if (key === 'company') return company?.name ?? <span className="record-muted">—</span>
    if (key === 'details') return <div className="contact-details">{current.primaryEmail && <a href={`mailto:${encodeURIComponent(current.primaryEmail)}`}>{current.primaryEmail}</a>}{current.primaryPhone && <a href={`tel:${current.primaryPhone.replace(/[^+\d]/g, '')}`}>{current.primaryPhone}</a>}{!current.primaryEmail && !current.primaryPhone && '—'}</div>
    if (key === 'notes') return <NotesCountCell workspaceId={props.workspaceId} contactId={current.id} contactName={current.displayName} onPreview={props.onPreview} />
    if (key === 'owner') return <select className="table-status-select" aria-label={label('Owner')} value={current.ownerMemberId ?? ''} onChange={e => save({ ownerMemberId: e.target.value || null })}>
      <option value="">Unassigned</option>{members.filter(m => m.status === 'active' || m.id === current.ownerMemberId).map(m => <option key={m.id} value={m.id}>{m.user.name}</option>)}
    </select>
    if (key === 'stage') return <select className="table-status-select" title="Current pipeline position; milestones remain independent." aria-label={label('Current stage')} value={current.leadStatus ?? ''} onChange={e => save({ leadStatus: e.target.value })}><option value="" disabled>No stage</option>{stageOptions.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
    if (key === 'followUp') return <FollowUpEditor label={label('Follow-up')} value={current.nextFollowUp} overdue={followUpLate(current)} onSave={value => save({ nextFollowUp: value })} />
    if (key === 'lastContactedAt') return <div className="contact-last-cell">
      <button
        type="button"
        className="contact-touch-btn"
        title="Record 1-click contact completed now"
        disabled={editor.pending}
        onClick={(e) => {
          e.stopPropagation()
          void save({
            logContact: true,
            contactLog: { channel: 'other', outcome: 'connected', note: 'Contacted' },
            lastContactedAt: new Date().toISOString(),
          })
        }}
      >
        ✓ Contacted
      </button>
      <span className="contact-last-info">
        {current.lastContactedAt ? <time title={new Date(current.lastContactedAt).toLocaleString()} dateTime={current.lastContactedAt}>{dateLabel(current.lastContactedAt)}</time> : <span className="record-muted">Never</span>}
        {typeof current.contacted === 'number' && current.contacted > 0 ? <small className="docs-name-sub"> ({current.contacted})</small> : null}
      </span>
    </div>
    if (key === 'leadSource') return editText(key, current.leadSource, 'text', 80)
    const field = definition(key)
    if (!field) return null
    const builtin = CONTACT_FIELD_DEFAULTS.some(f => f.key === key) && !['category', 'location'].includes(key)
    const value = builtin ? current[key as keyof Contact] : current.fieldValues?.[key]
    const patch = (value: string | boolean | null) => builtin ? { [key]: value } : { fieldValues: { [key]: value } }
    if (field.type === 'checkbox') return <input type="checkbox" title={isMilestone(key) ? CONTACT_MILESTONE_HELP[key] : field.label} aria-label={label(field.label)} checked={value === true} onChange={e => save(patch(e.target.checked))} />
    if (field.type === 'select') return <select className="table-status-select" aria-label={label(field.label)} value={typeof value === 'string' ? value : ''} onChange={e => save(patch(e.target.value || null))}>
      {key !== 'priority' && <option value="">—</option>}{field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    return <div className="contact-number-cell">{editText(key, value as string | number | null, field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text', builtin ? 255 : 1000, !builtin)}{field.numberConfig?.unit && <small>{field.numberConfig.unit}</small>}</div>
  }
  const feedback = <ContactEditFeedback editor={editor} definitions={definitions} />
  const selection = <input type="checkbox" aria-label={`Select ${current.displayName}`} checked={props.selected.includes(current.id)} disabled={!props.selected.includes(current.id) && props.selected.length >= 50} onChange={() => props.onToggle(current.id)} />
  const dialogs = <>
    {notesOpen && <RecordFormDialog title={`Notes · ${current.displayName}`} onClose={() => setNotesOpen(false)}><RecordNotes workspaceId={props.workspaceId} subject={{ contactId: current.id }} recordName={current.displayName} /></RecordFormDialog>}
    {logOpen && <ContactLogForm contact={current} editor={editor} feedback={feedback} onClose={() => setLogOpen(false)} />}
  </>
  if (mobile) {
    const primary = ['nextAction', 'followUp']
    const milestones = definitions.filter(f => isMilestone(f.key) && !f.archived)
    const extra = [...new Set(['owner', 'lastContactedAt', 'stage', 'interestedIn', 'details', ...visible.filter(key => !primary.includes(key) && !isMilestone(key))])]
    return <article className="contact-mobile-card" aria-label={current.displayName} data-selected={props.selected.includes(current.id) || undefined}>
      <header>{selection}<div className="contact-identity">
        <a href={props.href(current.id)} data-record-link={current.id} onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); props.onOpen(current.id) } }}>{current.displayName}</a>
        {(company?.name || current.title) && <small className="contact-company">{company?.name ?? current.title}</small>}
      </div></header>
      {!logOpen && feedback}
      <div className="contact-mobile-primary">{primary.map(key => <label key={key}><span>{key === 'followUp' ? 'Follow-up' : definition(key)?.label ?? 'Next action'}</span>{fieldCell(key)}</label>)}</div>
      <fieldset className="contact-mobile-milestones"><legend>Completed milestones</legend>{milestones.map(f => <label key={f.key}>{fieldCell(f.key)}<span>{f.label}</span></label>)}</fieldset>
      <details className="contact-mobile-more"><summary>More details</summary><div>{extra.map(key => <label key={key}><span>{columnsFor(definitions).find(c => c.key === key)?.label ?? key}</span>{fieldCell(key)}</label>)}</div></details>
      {dialogs}
    </article>
  }
  return <tr data-selected={props.selected.includes(current.id) || props.previewId === current.id || undefined} onClick={() => props.onOpen(current.id)}>
    <td className="table-col-check" onClick={e => e.stopPropagation()}>{selection}</td>
    <td scope="row" className="contact-name">
      <div className="contact-name-cell">
        <RecordMedia person name={current.displayName} src={current.imageUrl} />
        <div className="contact-name-info">
          <a href={props.href(current.id)} data-record-link={current.id} onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); props.onOpen(current.id) } }}>{current.displayName}</a>
          {(company?.name || current.title) && <small className="docs-name-sub">{company?.name ?? current.title}</small>}
        </div>
      </div>
      {!logOpen && feedback}{dialogs}
    </td>
    {visible.map(key => <td key={key} className={isMilestone(key) ? 'contact-milestone' : `contact-column-${key}`} onClick={e => e.stopPropagation()}>{fieldCell(key)}</td>)}
    <td className="docs-col-action" onClick={e => e.stopPropagation()}>
      <button type="button" className="docs-preview-btn" aria-label={`Preview ${current.displayName}`} onClick={() => props.onPreview(current.id, current.displayName)}>
        Preview ↗
      </button>
    </td>
  </tr>
}

function ContactEditFeedback({ editor, definitions }: { editor: ReturnType<typeof useContactRowEditor>; definitions: ContactFieldDefinition[] }) {
  const labelFor = (key: string) => definitions.find(f => f.key === key)?.label ?? ({ nextFollowUp: 'Follow-up', ownerMemberId: 'Owner', leadStatus: 'Current stage' } as Record<string, string>)[key] ?? key
  const display = (value: unknown) => value === true ? 'Checked' : value === false ? 'Unchecked' : value == null || value === '' ? 'Empty' : String(value)
  const entries = Object.entries(editor.draft).filter(([key]) => key !== 'fieldValues').map(([key, value]) => ({ key, value, current: editor.latest[key as keyof Contact] }))
  for (const [key, value] of Object.entries(editor.draft.fieldValues ?? {})) entries.push({ key, value, current: editor.latest.fieldValues[key] ?? null })
  if (editor.error) return <div className="contact-save-error">
    <p role="alert">{editor.reviewing ? 'Your edits are preserved. Review the current values before saving.' : editor.error.message}</p>
    {editor.reviewing ? <>
      <dl className="contact-conflict-values">{entries.map(({ key, value, current }) => <div key={key}><dt>{labelFor(key)}</dt><dd>Current: {display(current)}</dd><dd>Your edit: {display(value)}</dd></div>)}</dl>
      <button onClick={editor.retry}>Reapply my edits</button><button onClick={editor.discard}>Use current values</button>
    </> : <><button disabled={editor.reloading} onClick={() => editor.conflict ? void editor.reload() : editor.retry()}>{editor.conflict ? editor.reloading ? 'Loading…' : 'Review current values' : 'Retry save'}</button><button onClick={editor.discard}>Discard edits</button></>}
  </div>
  return <small className="contact-save-status" role="status">{editor.pending ? 'Saving…' : editor.saved ? 'Saved' : ''}</small>
}

function FollowUpEditor({ value, label, overdue, onSave }: { value: string | null; label: string; overdue: boolean; onSave: (value: string | null) => void }) {
  return <div className="contact-followup" data-overdue={overdue || undefined}>
    <CellInput label={label} type="date" value={localDay(value)} onSave={day => onSave(followUpInstant(day))} />
    {overdue && <small>Overdue</small>}
  </div>
}

function ContactLogForm({ contact, editor, feedback, onClose }: { contact: Contact; editor: ReturnType<typeof useContactRowEditor>; feedback: ReactNode; onClose: () => void }) {
  const [channel, setChannel] = useState<'email' | 'phone' | 'text' | 'other'>(contact.primaryEmail ? 'email' : contact.primaryPhone ? 'phone' : 'other')
  const [outcome, setOutcome] = useState<'sent' | 'connected' | 'noAnswer' | 'leftMessage'>('sent')
  const [note, setNote] = useState('')
  const [next, setNext] = useState(localDay(contact.nextFollowUp))
  const [submitting, setSubmitting] = useState(false)
  const submit = async () => {
    setSubmitting(true)
    const ok = await editor.save({ logContact: true, contactLog: { channel, outcome, note: note.trim() || undefined }, ...(next !== localDay(contact.nextFollowUp) ? { nextFollowUp: followUpInstant(next) } : {}) })
    setSubmitting(false)
    if (ok) onClose()
  }
  return <RecordFormDialog title={`Log contact · ${contact.displayName}`} onClose={onClose}>
    <form className="contact-log-form" onSubmit={e => { e.preventDefault(); void submit() }}>
      <p>Record outreach you have completed.</p>
      <label>Channel<select value={channel} onChange={e => { const value = e.target.value as typeof channel; setChannel(value); setOutcome(value === 'phone' ? 'connected' : 'sent') }}><option value="email">Email</option><option value="phone">Call</option><option value="text">Text</option><option value="other">Other</option></select></label>
      <label>Outcome<select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="sent">Sent</option><option value="connected">Connected</option><option value="noAnswer">No answer</option><option value="leftMessage">Left a message</option></select></label>
      <label>Short note<textarea maxLength={2000} rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label>Next follow-up<input type="date" value={next} onChange={e => setNext(e.target.value)} /></label>
      <div className="contact-date-shortcuts">{[[0, 'Today'], [1, 'Tomorrow'], [7, 'Next week']].map(([offset, text]) => <button type="button" key={String(offset)} onClick={() => setNext(followUpDay(Number(offset)))}>{text}</button>)}</div>
      {feedback}
      <footer><button type="button" onClick={onClose}>Close</button><button className="record-primary" disabled={submitting || !!editor.error}>{submitting ? 'Saving…' : 'Log contact'}</button></footer>
    </form>
  </RecordFormDialog>
}

function CellInput({ value, onSave, label, type = 'text', maxLength = 255, numberConfig }: {
  value: string; onSave: (value: string) => void; label: string; type?: string; maxLength?: number; numberConfig?: ContactFieldDefinition['numberConfig']
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const focused = useRef(false)
  const skipBlur = useRef(false)
  const lastSent = useRef(value)
  useEffect(() => { if (!focused.current) { setDraft(value); lastSent.current = value } }, [value])
  return <input aria-label={label} type={type} value={draft} maxLength={maxLength} data-editing={editing || undefined}
    min={type === 'number' ? numberConfig?.minimum : undefined} max={type === 'number' ? numberConfig?.maximum : undefined} step={type === 'number' ? numberConfig?.precision == null ? 'any' : 10 ** -numberConfig.precision : undefined}
    placeholder="—" onChange={e => setDraft(e.target.value)} onFocus={() => { focused.current = true; setEditing(true) }}
    onBlur={e => { focused.current = false; setEditing(false); if (!skipBlur.current && draft.trim() !== lastSent.current && e.currentTarget.reportValidity()) { lastSent.current = draft.trim(); onSave(draft.trim()) } skipBlur.current = false }}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { e.preventDefault(); skipBlur.current = true; setDraft(value); lastSent.current = value; e.currentTarget.blur() } }} />
}
