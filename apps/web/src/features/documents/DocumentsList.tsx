import { useMemo, useState } from 'react'
import { PersonName } from '../../components/PersonName'
import { FormSlideout } from '../work/FormSlideout'
import { SectionHeader } from '../work/SectionHeader'
import { DocIcon, kindOf, type DocKind } from './DocIcon'
import { markOf, whenLabel } from './format'
import { blankDoc } from './seed'
import { useDocuments } from './store'
import type { DocumentRecord } from './types'
import './DocumentsList.css'

type SortKey = 'title' | 'owner' | 'updated' | 'type'
type Sort = { key: SortKey; dir: 1 | -1 }

const COLUMNS: { key: SortKey; label: string; first: 1 | -1 }[] = [
  { key: 'title', label: 'Name', first: 1 },
  { key: 'owner', label: 'Owner', first: 1 },
  { key: 'updated', label: 'Updated', first: -1 },
  { key: 'type', label: 'Type', first: 1 },
]

const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

function compare(key: SortKey, a: DocumentRecord, b: DocumentRecord) {
  if (key === 'title') return text(a.title, b.title)
  if (key === 'owner') return text(a.ownerName, b.ownerName)
  if (key === 'type') return text(markOf(a), markOf(b))
  return a.updatedAt - b.updatedAt
}

const GROUPS: { kind: DocKind; surface: DocumentRecord['surface']; title: string; label: string; kinds: DocKind[] }[] = [
  { kind: 'doc', surface: 'blocks', title: 'Documents', label: 'document', kinds: ['doc', 'gdoc'] },
  { kind: 'sheet', surface: 'grid', title: 'Sheets', label: 'sheet', kinds: ['sheet', 'gsheet', 'contacts'] },
  { kind: 'map', surface: 'mental_map', title: 'Maps', label: 'map', kinds: ['map'] },
]

export function DocumentsList({ owner }: { owner: string }) {
  const docs = useDocuments((state) => state.docs)
  const add = useDocuments((state) => state.add)
  const [adding, setAdding] = useState(false)
  const [surface, setSurface] = useState<DocumentRecord['surface']>('blocks')

  return (
    <div className="docs-table-wrap">
      <SectionHeader title="Documents" level={1} newLabel="document" onNew={() => setAdding(true)} />
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
      {GROUPS.map((group) => (
        <DocumentsTable key={group.kind} group={group} docs={docs.filter((doc) => group.kinds.includes(kindOf(doc)))} />
      ))}
    </div>
  )
}

function DocumentsTable({ group, docs }: { group: typeof GROUPS[number]; docs: DocumentRecord[] }) {
  const open = useDocuments((state) => state.open)
  const [sort, setSort] = useState<Sort>({ key: 'updated', dir: -1 })

  // Ties fall back to most recently updated, so the order never jumps.
  const rows = useMemo(
    () => [...docs].sort((a, b) => sort.dir * compare(sort.key, a, b) || b.updatedAt - a.updatedAt),
    [docs, sort],
  )

  const sortBy = (key: SortKey, first: 1 | -1) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: first }))

  return (
    <section className="docs-group" aria-labelledby={`docs-group-${group.kind}`}>
      <SectionHeader
        title={group.title}
        titleId={`docs-group-${group.kind}`}
      />
      <table className="docs-table" aria-labelledby={`docs-group-${group.kind}`}>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = sort.key === column.key
              return (
                <th
                  key={column.key}
                  className={`docs-col-${column.key}`}
                  aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="docs-sort" data-active={active || undefined} onClick={() => sortBy(column.key, column.first)}>
                    {column.label}
                    <span className="docs-sort-dir" aria-hidden>{active ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
                  </button>
                </th>
              )
            })}
            <th className="docs-col-action"><span className="docs-sort">Preview</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="docs-none"><td colSpan={5}>No {group.title.toLowerCase()} yet. Start one with + New.</td></tr>
          ) : rows.map((doc) => {
            const kind = kindOf(doc)
            const external = doc.surface === 'external'
            return (
              <tr key={doc.id} data-kind={kind} onClick={() => open(doc.id)}>
                <td className="docs-col-title">
                  <button type="button" className="docs-name" onClick={(event) => { event.stopPropagation(); open(doc.id) }}>
                    <DocIcon kind={kind} />
                    <span className="docs-name-text">{doc.title || 'Untitled'}</span>
                    {external && <span className="docs-out" aria-label="Opens in a new tab">↗</span>}
                  </button>
                </td>
                <td className="docs-col-owner"><PersonName name={doc.ownerName} /></td>
                <td className="docs-col-updated"><time dateTime={new Date(doc.updatedAt).toISOString()}>{whenLabel(doc.updatedAt)}</time></td>
                <td className="docs-col-type">{markOf(doc)}</td>
                <td className="docs-col-action" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="docs-preview-btn" onClick={() => open(doc.id)}>
                    Preview ↗
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
