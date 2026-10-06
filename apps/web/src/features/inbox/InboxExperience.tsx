import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useArchiveInboxItem, useInboxItems, useInboxStream, useReadInboxItem, useStarInboxItem, type InboxItem } from '@project/sdk'
import { Composer } from '../compose/Composer'
import { useDocuments } from '../documents/store'
import { useCurrentWorkspace } from '../documents/workspace'
import type { Desk } from '../work/sections'

type Filter = 'all' | 'unread' | 'starred' | 'archived'

function contactIdOf(item: InboxItem) {
  if (item.action.verb === 'compose') return item.action.contactId
  if (item.sourceType === 'contact') return item.sourceId
  return null
}

const whenShown: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }

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
  const rows = useMemo(() => {
    const pages = list.data?.pages
    if (!pages) return []
    const out: { item: InboxItem; when: string }[] = []
    for (const page of pages) {
      for (const item of page.data) out.push({ item, when: new Date(item.createdAt).toLocaleString(undefined, whenShown) })
    }
    return out
  }, [list.data])
  const contactId = reply && contactIdOf(reply)

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
    if (contactIdOf(item)) setReply(item)
  }

  return (
    <div className="work-frame">
      <div className="work-bar" role="toolbar" aria-label="Inbox filters">
        {(['all', 'unread', 'starred', 'archived'] as const).map((id) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{id}</button>
        ))}
      </div>
      {reply && contactId && (
        <Composer
          workspaceId={workspace.id}
          contactId={contactId}
          contextType={reply.action.verb === 'compose' ? reply.sourceType : 'contact'}
          contextId={reply.action.verb === 'compose' ? reply.sourceId : contactId}
          onClose={() => setReply(null)}
        />
      )}
      {rows.length === 0 ? <p className="work-quiet">Nothing waiting.</p> : (
        <ul className="work-lines">
          {rows.map(({ item, when }) => (
            <li key={item.id}>
              <div className="work-inbox-line" data-needs={item.unread || undefined}>
                <button type="button" className="work-line-title" onClick={() => open(item)}>{item.title}</button>
                <span>{item.summary}</span>
                <time dateTime={item.createdAt}>{when}</time>
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
