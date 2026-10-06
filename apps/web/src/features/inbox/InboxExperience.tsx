import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useArchiveInboxItem, useInboxItems, useInboxStream, useReadInboxItem, useStarInboxItem, type InboxItem } from '@project/sdk'
import { Composer } from '../compose/Composer'
import { useDocuments } from '../documents/store'
import { useCurrentWorkspace } from '../documents/workspace'
import type { Desk } from '../work/sections'

type Filter = 'all' | 'unread' | 'starred' | 'archived'

const params: Record<Filter, { archived?: boolean; unread?: boolean; starred?: boolean }> = {
  all: {},
  unread: { unread: true },
  starred: { starred: true },
  archived: { archived: true },
}

export function InboxExperience({ onPlace }: { onPlace?: (desk: Desk) => void }) {
  const { workspace, loading } = useCurrentWorkspace()
  const [filter, setFilter] = useState<Filter>('all')
  const [reply, setReply] = useState<InboxItem | null>(null)
  const list = useInboxItems(workspace?.id, params[filter])
  useInboxStream(workspace?.id)
  const read = useReadInboxItem(workspace?.id ?? '')
  const star = useStarInboxItem(workspace?.id ?? '')
  const archive = useArchiveInboxItem(workspace?.id ?? '')
  const navigate = useNavigate()
  const openDocument = useDocuments((state) => state.open)
  const items = list.data?.pages.flatMap((page) => page.data) ?? []

  if (loading) return null
  if (!workspace) return <p className="work-empty">Nothing waiting.</p>

  const open = (item: InboxItem) => {
    if (item.unread) read.mutate({ inboxItemId: item.id, unread: false })
    if (item.sourceType === 'conversation') {
      navigate(`/room/${item.sourceId}`)
      return
    }
    if (item.sourceType === 'document') {
      openDocument(item.sourceId)
      onPlace?.('documents')
      return
    }
    if (item.sourceType === 'calendar') {
      onPlace?.('calendar')
      return
    }
    const contactId = item.action.verb === 'compose' ? item.action.contactId : item.sourceType === 'contact' ? item.sourceId : undefined
    if (contactId) setReply(item)
  }

  return (
    <div className="work-frame">
      <div className="work-bar" role="toolbar" aria-label="Inbox filters">
        {(['all', 'unread', 'starred', 'archived'] as const).map((id) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{id}</button>
        ))}
      </div>
      {reply && reply.action.verb === 'compose' && reply.action.contactId && (
        <Composer workspaceId={workspace.id} contactId={reply.action.contactId} contextType={reply.sourceType} contextId={reply.sourceId} onClose={() => setReply(null)} />
      )}
      {reply && reply.action.verb !== 'compose' && reply.sourceType === 'contact' && (
        <Composer workspaceId={workspace.id} contactId={reply.sourceId} contextType="contact" contextId={reply.sourceId} onClose={() => setReply(null)} />
      )}
      {items.length === 0 ? <p className="work-quiet">Nothing waiting.</p> : (
        <ul className="work-lines">
          {items.map((item) => (
            <li key={item.id}>
              <div className="work-inbox-line" data-needs={item.unread || undefined}>
                <button type="button" className="work-line-title" onClick={() => open(item)}>{item.title}</button>
                <span>{item.summary}</span>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                <span className="work-mark">{item.unread ? 'Unread' : 'Read'}</span>
                <button type="button" aria-pressed={item.starred} onClick={() => star.mutate({ inboxItemId: item.id, starred: !item.starred })}>{item.starred ? 'Starred' : 'Star'}</button>
                <button type="button" onClick={() => archive.mutate({ inboxItemId: item.id, archived: filter !== 'archived' })}>{filter === 'archived' ? 'Restore' : 'Archive'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
