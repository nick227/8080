import { DocMenu } from './DocMenu'
import { useDocuments } from './store'

// Shown only while a document is open; the list has one shared New entry point.
export function DocumentsHeader() {
  const docs = useDocuments((state) => state.docs)
  const openId = useDocuments((state) => state.openId)
  const open = useDocuments((state) => state.open)
  const change = useDocuments((state) => state.change)
  const remove = useDocuments((state) => state.remove)
  const doc = docs.find((item) => item.id === openId)
  if (!doc) return null

  return (
    <div className="work-bar docs-header">
      <button type="button" className="docs-back" onClick={() => open(null)}>Back</button>
      <input
        className="docs-title-input"
        aria-label="Title"
        value={doc.title}
        onChange={(event) => change(doc.id, (current) => ({ ...current, title: event.target.value }))}
      />
      <DocMenu onDelete={() => remove(doc.id)} />
    </div>
  )
}
