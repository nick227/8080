import { PersonName } from '../../components/PersonName'
import { markOf, whenLabel } from './format'
import { blankDoc } from './seed'
import { useDocuments } from './store'
import type { DocumentRecord } from './types'

export function DocumentsList({ owner }: { owner: string }) {
  const docs = useDocuments((state) => state.docs)
  const add = useDocuments((state) => state.add)
  const open = useDocuments((state) => state.open)
  const create = (doc: DocumentRecord) => add(doc)

  return (
    <div className="work-list">
      <div className="work-bar">
        <button type="button" onClick={() => create(blankDoc('blocks', owner))}>Block</button>
        <button type="button" onClick={() => create(blankDoc('mental_map', owner))}>Map</button>
        <button type="button" onClick={() => create(blankDoc('grid', owner))}>Sheet</button>
        <button type="button" onClick={() => create(blankDoc('grid', owner, 'contacts'))}>Contacts</button>
      </div>
      {docs.length === 0 ? <p className="work-empty">No documents yet.</p> : (
        <ul className="work-lines">
          {docs.map((doc) => (
            <li key={doc.id}>
              <button type="button" className="work-line" onClick={() => open(doc.id)}>
                <span className="work-line-title">{doc.title}</span>
                <PersonName className="work-who" name={doc.ownerName} />
                <time dateTime={new Date(doc.updatedAt).toISOString()}>{whenLabel(doc.updatedAt)}</time>
                <span className="work-mark">{markOf(doc)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
