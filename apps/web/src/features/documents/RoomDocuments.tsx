import { useEffect } from 'react'
import { markOf } from './format'
import { useDocuments } from './store'

export function RoomDocuments({ roomId, owner, onOpen }: { roomId?: string; owner: string; onOpen: () => void }) {
  const docs = useDocuments((state) => state.docs)
  const ensure = useDocuments((state) => state.ensure)
  const open = useDocuments((state) => state.open)
  useEffect(() => { ensure(owner) }, [ensure, owner])
  if (!roomId) return null
  const linked = docs.filter((doc) => doc.roomIds.includes(roomId))

  return (
    <section className="room-documents" aria-label="Documents">
      <div className="work-bar">Documents</div>
      {linked.length === 0 ? <p className="work-empty">Nothing linked.</p> : (
        <ul className="work-lines">
          {linked.map((doc) => (
            <li key={doc.id}>
              <button type="button" className="work-line" data-compact onClick={() => { open(doc.id); onOpen() }}>
                <span className="work-line-title">{doc.title}</span>
                <span className="work-mark">{markOf(doc)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
