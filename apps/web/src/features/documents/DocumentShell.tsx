import { markOf, whenLabel } from './format'
import { adapterFor } from './editors'
import { useDocumentPresence, useLocalActivity, usePeers } from './presence'
import { useDocuments } from './store'

export function DocumentShell({ roomId, owner }: { roomId?: string; owner: string }) {
  const docs = useDocuments((state) => state.docs)
  const openId = useDocuments((state) => state.openId)
  const open = useDocuments((state) => state.open)
  const change = useDocuments((state) => state.change)
  const remove = useDocuments((state) => state.remove)
  const linkRoom = useDocuments((state) => state.linkRoom)
  const status = useDocuments((state) => state.status)
  const doc = docs.find((item) => item.id === openId)
  useDocumentPresence(doc?.id ?? 'none', owner)
  const peers = usePeers()
  const activity = useLocalActivity()
  if (!doc) return null
  const editor = adapterFor(doc)
  const linked = roomId ? doc.roomIds.includes(roomId) : false
  const Editor = editor.Editor

  return (
    <section className="work-sheet" aria-label={doc.title}>
      <div className="work-bar">
        <button type="button" onClick={() => open(null)}>Back</button>
        <input aria-label="Title" value={doc.title} onChange={(event) => change(doc.id, (current) => ({ ...current, title: event.target.value }))} />
        <span className="work-mark">{markOf(doc)}</span>
        {editor.capabilities(doc).showNativePresence && (
          <span className="work-roster">
            <span>You · {activity}</span>
            {peers.map((peer) => <span key={peer.clientId}>{peer.name} · {peer.activity}</span>)}
          </span>
        )}
        <span role="status">{status}</span>
        <button type="button" onClick={() => remove(doc.id)}>Delete</button>
      </div>
      <div className="work-fields">
        <p className="work-field"><span>Who</span>{doc.ownerName}</p>
        <p className="work-field"><span>When</span><time dateTime={new Date(doc.updatedAt).toISOString()}>{whenLabel(doc.updatedAt)}</time></p>
        {roomId && (
          <button type="button" aria-pressed={linked} onClick={() => linkRoom(doc.id, roomId)}>In this room</button>
        )}
      </div>
      <div className="work-frame" data-surface={doc.surface}>
        <Editor doc={doc} />
      </div>
    </section>
  )
}
