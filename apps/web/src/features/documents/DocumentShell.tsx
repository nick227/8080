
import { adapterFor } from './editors'
import { useDocumentPresence } from './presence'
import { useDocuments } from './store'

export function DocumentShell({ roomId, owner }: { roomId?: string; owner: string }) {
  const docs = useDocuments((state) => state.docs)
  const openId = useDocuments((state) => state.openId)
  const linkRoom = useDocuments((state) => state.linkRoom)
  const doc = docs.find((item) => item.id === openId)
  useDocumentPresence(doc?.id ?? 'none', owner)
  if (!doc) return null
  const editor = adapterFor(doc)
  const linked = roomId ? doc.roomIds.includes(roomId) : false
  const Editor = editor.Editor

  return (
    <section className="work-sheet" aria-label={doc.title}>

      <div className="work-frame" data-surface={doc.surface}>
        <Editor doc={doc} />
      </div>
    </section>
  )
}
