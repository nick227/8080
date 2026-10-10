import { useMemo, useState } from 'react'
import { PersonName } from '../../components/PersonName'
import { FormSlideout } from '../work/FormSlideout'
import { CollectionView } from '../collections/CollectionView'
import { ColumnsMenu, FilterChips } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { matches, useTableState, useUrlSearch, type Column } from '../collections/table'
import { DocIcon, kindOf, type DocKind } from './DocIcon'
import { markOf, whenLabel } from './format'
import { blankDoc } from './seed'
import { useDocuments } from './store'
import type { DocumentRecord } from './types'
import './DocumentsList.css'

type Show = 'all' | 'doc' | 'sheet' | 'map'
const GROUPS: { id: Exclude<Show, 'all'>; label: string; kinds: DocKind[] }[] = [
  { id: 'doc', label: 'Documents', kinds: ['doc', 'gdoc'] },
  { id: 'sheet', label: 'Sheets', kinds: ['sheet', 'gsheet', 'contacts'] },
  { id: 'map', label: 'Maps', kinds: ['map'] },
]
const groupOf = (doc: DocumentRecord) => GROUPS.find((g) => g.kinds.includes(kindOf(doc)))?.id ?? 'doc'

/** Documents as a shared collection (redesign D9): one table, filtered by type. */
export function DocumentsList({ owner }: { owner: string }) {
  const docs = useDocuments((state) => state.docs)
  const add = useDocuments((state) => state.add)
  const open = useDocuments((state) => state.open)
  const [adding, setAdding] = useState(false)
  const [surface, setSurface] = useState<DocumentRecord['surface']>('blocks')
  const [show, setShow] = useState<Show>('all')
  const search = useUrlSearch()
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
  ], [])
  const table = useTableState('documents', columns, { id: 'updated', dir: -1 })
  const count = (id: Exclude<Show, 'all'>) => docs.filter((d) => groupOf(d) === id).length
  // Ties fall back to most recently updated, so the order never jumps.
  const rows = table.sortRows(
    docs.filter((d) => (show === 'all' || groupOf(d) === show) && matches(search.q, d.title, d.ownerName, markOf(d))),
    (a, b) => b.updatedAt - a.updatedAt,
  )

  return (
    <CollectionView
      collection="documents"
      count={docs.length}
      onNew={() => setAdding(true)}
      search={{ value: search.value, onChange: search.setValue }}
      filters={<FilterChips label="Type" value={show} onChange={setShow} options={[
        { id: 'all', label: 'All', count: docs.length },
        ...GROUPS.map((g) => ({ id: g.id, label: g.label, count: count(g.id) })),
      ]} />}
      view={<ColumnsMenu state={table} />}
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
      <DataTable
        label="Documents"
        rows={rows}
        getId={(d) => d.id}
        state={table}
        onOpen={(d) => open(d.id)}
        rowProps={(d) => ({ 'data-kind': kindOf(d) })}
        empty={docs.length === 0 ? 'No documents yet. Start one with + New document.' : 'No documents match.'}
      />
    </CollectionView>
  )
}
