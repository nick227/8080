import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PersonName } from '../../components/PersonName'
import { FormSlideout } from '../work/FormSlideout'
import { CollectionView } from '../collections/CollectionView'
import { ColumnsMenu, FilterChips } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { matches, useTableState, useUrlSearch, type Column } from '../collections/table'
import { BulkMessage, SelectionBar, deleteColumn, useBulkDelete, useSelection } from '../collections/selection'
import { DocIcon, kindOf, type DocKind } from './DocIcon'
import { markOf, whenLabel } from './format'
import { blankDoc } from './seed'
import { useDocuments } from './store'
import type { DocumentRecord } from './types'
import { StarterPackPicker } from '../prefab/StarterPackPicker'
import { ImportModalTabs } from '../prefab/ImportModalChrome'
import { CsvExample } from '../../components/CsvExample'
import type { PrefabDocument } from '@project/shared'
import './DocumentsList.css'

type Show = 'all' | 'doc' | 'sheet' | 'map'
const GROUPS: { id: Exclude<Show, 'all'>; label: string; kinds: DocKind[] }[] = [
  { id: 'doc', label: 'Documents', kinds: ['doc', 'gdoc'] },
  { id: 'sheet', label: 'Sheets', kinds: ['sheet', 'gsheet', 'contacts'] },
  { id: 'map', label: 'Maps', kinds: ['map'] },
]
// Deleting a shared document needs manage access (its owner, or a manager); local ones are this browser's.
const canDelete = (doc: DocumentRecord) => !doc.shared || doc.shared.canManage
const groupOf = (doc: DocumentRecord) => GROUPS.find((g) => g.kinds.includes(kindOf(doc)))?.id ?? 'doc'

/** Documents as a shared collection (redesign D9): one table, filtered by type. */
export function DocumentsList({ owner }: { owner: string }) {
  const docs = useDocuments((state) => state.docs)
  const add = useDocuments((state) => state.add)
  const open = useDocuments((state) => state.open)
  const remove = useDocuments((state) => state.remove)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [surface, setSurface] = useState<DocumentRecord['surface']>('blocks')
  const [show, setShow] = useState<Show>('all')
  const search = useUrlSearch()
  const removal = useBulkDelete({
    noun: { one: 'document', many: 'documents' },
    remove,
    warning: 'They’re removed for everyone they’re shared with.',
  })
  const runRemoval = removal.run
  const columns = useMemo<Column<DocumentRecord>[]>(() => [
    {
      id: 'title', header: 'Name', width: '44%', hideable: false, sortValue: (d) => d.title || 'Untitled', title: (d) => d.title || 'Untitled',
      cell: (doc) => (
        <span className="docs-name">
          <DocIcon kind={kindOf(doc)} />
          <span className="docs-name-text">{doc.title || 'Untitled'}</span>
          {kindOf(doc) === 'contacts' && <span className="docs-name-tag">dataset</span>}
          {doc.surface === 'external' && <span className="docs-out" aria-label="Opens in a new tab">↗</span>}
        </span>
      ),
    },
    { id: 'type', header: 'Type', cell: (d) => markOf(d), sortValue: (d) => markOf(d) },
    { id: 'owner', header: 'Owner', cell: (d) => <PersonName name={d.ownerName} />, sortValue: (d) => d.ownerName },
    { id: 'updated', header: 'Updated', firstDir: -1, cell: (d) => <time dateTime={new Date(d.updatedAt).toISOString()}>{whenLabel(d.updatedAt)}</time>, sortValue: (d) => d.updatedAt },
    deleteColumn<DocumentRecord>({ name: (d) => d.title || 'Untitled', can: canDelete, onDelete: (d) => void runRemoval([d.id], d.title || 'Untitled') }),
  ], [runRemoval])
  const table = useTableState('documents', columns, { id: 'updated', dir: -1 })
  const count = (id: Exclude<Show, 'all'>) => docs.filter((d) => groupOf(d) === id).length
  // Ties fall back to most recently updated, so the order never jumps.
  const rows = table.sortRows(
    docs.filter((d) => (show === 'all' || groupOf(d) === show) && matches(search.q, d.title, d.ownerName, markOf(d))),
    (a, b) => b.updatedAt - a.updatedAt,
  )
  const selection = useSelection(useMemo(() => rows.map((d) => d.id), [rows]))

  const handleImportDocs = (records: any[]) => {
    const now = Date.now()
    for (const r of records) {
      const doc = r as PrefabDocument
      const lines = doc.content.split('\n')
      const blocks = lines.map((text) => {
        if (text.startsWith('# ')) return { id: crypto.randomUUID(), type: 'section' as const, level: 'h1' as const, text: text.slice(2) }
        if (text.startsWith('## ')) return { id: crypto.randomUUID(), type: 'section' as const, level: 'h2' as const, text: text.slice(3) }
        return { id: crypto.randomUUID(), type: 'section' as const, level: 'body' as const, text }
      })
      add({
        id: crypto.randomUUID(),
        title: doc.title,
        surface: 'blocks',
        ownerName: owner,
        updatedAt: now,
        roomIds: [],
        blocks: blocks.length ? blocks : [{ id: crypto.randomUUID(), type: 'section' as const, level: 'body' as const, text: doc.summary }],
      })
    }
    setImporting(false)
  }

  return (
    <CollectionView
      collection="documents"
      count={docs.length}
      onNew={() => setAdding(true)}
      onImport={() => setImporting(true)}
      search={{ value: search.value, onChange: search.setValue }}
      filters={<FilterChips label="Type" value={show} onChange={setShow} options={[
        { id: 'all', label: 'All', count: docs.length },
        ...GROUPS.map((g) => ({ id: g.id, label: g.label, count: count(g.id) })),
      ]} />}
      view={<ColumnsMenu state={table} />}
      notice={<BulkMessage result={removal.result} onDismiss={removal.dismiss} />}
    >
      {adding && (
        <FormSlideout title="New document" onClose={() => setAdding(false)}>
          <form className="record-form" onSubmit={(event) => {
            event.preventDefault()
            add(blankDoc(surface, owner))
            setAdding(false)
          }}>
            <div className="record-form-fields">
              <label>
                <span>Document type</span>
                <select autoFocus value={surface} onChange={(event) => setSurface(event.target.value as DocumentRecord['surface'])}>
                  <option value="blocks">Document</option>
                  <option value="grid">Sheet</option>
                  <option value="mental_map">Map</option>
                </select>
              </label>
            </div>
            <footer>
              <button type="button" onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" className="record-primary">Create</button>
            </footer>
          </form>
        </FormSlideout>
      )}
      {importing && (
        <ImportDocumentsSlideout
          owner={owner}
          onClose={() => setImporting(false)}
          onImportDocs={handleImportDocs}
        />
      )}
      <DataTable
        label="Documents"
        rows={rows}
        getId={(d) => d.id}
        state={table}
        onOpen={(d) => open(d.id)}
        rowProps={(d) => ({ 'data-kind': kindOf(d) })}
        selection={{ selected: selection.selected, onChange: selection.set, disabled: (d) => (canDelete(d) ? false : 'Only its owner or a manager can delete this') }}
        empty={docs.length === 0 ? 'No documents yet. Start one with + New document.' : 'No documents match.'}
      />
      <SelectionBar count={selection.selected.size} onClear={selection.clear} busy={removal.busy} onDelete={() => void removal.run(selection.ids)} />
    </CollectionView>
  )
}

function ImportDocumentsSlideout({
  owner,
  onClose,
  onImportDocs,
}: {
  owner: string
  onClose: () => void
  onImportDocs: (records: any[]) => void
}) {
  const [tab, setTab] = useState<string>('starter')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleCsvSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) {
      setError('Please provide at least one document row or title.')
      return
    }
    const hasHeader = lines[0].toLowerCase().includes('title') || lines[0].toLowerCase().includes('name')
    const dataLines = hasHeader ? lines.slice(1) : lines
    const parsedDocs: PrefabDocument[] = []
    for (const line of dataLines) {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''))
      const title = parts[0]
      if (!title) continue
      const summary = parts[1] || `Imported document: ${title}`
      const content = parts[2] ? parts.slice(2).join(',') : `# ${title}\n\n${summary}`
      parsedDocs.push({
        key: `custom-${crypto.randomUUID().slice(0, 8)}`,
        packId: 'custom-csv',
        version: 1,
        source: { provenance: 'synthetic-editorial' },
        title,
        kind: 'agreement',
        summary,
        content,
        requiresReview: false,
      })
    }
    if (parsedDocs.length === 0) {
      setError('Could not parse any valid documents from the CSV.')
      return
    }
    onImportDocs(parsedDocs)
  }

  return (
    <FormSlideout
      title="Import Documents & SOPs"
      width="640px"
      onClose={onClose}
    >
      <ImportModalTabs
        tabs={[
          { id: 'starter', label: 'Starter Packs' },
          { id: 'csv', label: 'CSV Upload' },
        ]}
        activeTab={tab}
        onSelectTab={setTab}
      />

      <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, overflowY: 'auto' }}>
        {tab === 'starter' && (
          <StarterPackPicker
            domain="documents"
            confirmLabel="Import Documents"
            onImport={onImportDocs}
            onCancel={onClose}
          />
        )}

        {tab === 'csv' && (
          <form className="budget-form" onSubmit={handleCsvSubmit}>
            <div className="budget-form-fields">
              <div className="budget-form-field">
                <label htmlFor="docs-import-csv">CSV</label>
                <textarea
                  id="docs-import-csv"
                  rows={8}
                  spellCheck={false}
                  autoFocus
                  placeholder={'title,summary\nStandard Service Agreement,Master contract for client engagements\nClient Onboarding SOP,Step-by-step checklist for new client kickoff'}
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError('') }}
                />
              </div>
              <CsvExample
                example={'title,summary\nStandard Service Agreement,Master contract for client engagements\nClient Onboarding SOP,Step-by-step checklist for new client kickoff'}
                note="Columns: title, summary (optional). Each line creates a workspace document."
              />
              {error && <p className="record-error" role="alert">{error}</p>}
            </div>

            <div className="record-form-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" className="cal-btn" onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
              <button type="button" className="cal-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="prefab-import-btn" disabled={!text.trim()}>
                Import Documents
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  void file.text().then((content) => {
                    setText(content)
                    setError('')
                  })
                }
                e.target.value = ''
              }}
            />
          </form>
        )}

      </div>
    </FormSlideout>
  )
}

