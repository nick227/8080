import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInboxItems, useInboxStream, useReadInboxItem, useTaskNotificationSettings, useUpdateTaskNotificationSettings, type InboxItem, type TaskNotificationSettings } from '@project/sdk'
import { since } from './BoardView'
import { useCalendar } from './store'

/** The viewer's task notifications (their inbox rows), opened from the calendar. */
export function ForYou({ workspaceId, onOpenTask }: { workspaceId: string; onOpenTask: (taskKey: string) => void }) {
  const list = useInboxItems(workspaceId, { sourceType: 'task' })
  useInboxStream(workspaceId)
  const read = useReadInboxItem(workspaceId)
  const settings = useTaskNotificationSettings(workspaceId)
  const saveSettings = useUpdateTaskNotificationSettings(workspaceId)
  const navigate = useNavigate()
  const tasks = useCalendar((s) => s.tasks)
  const say = useCalendar((s) => s.say)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Task notifications only: chat activity has its own place in the rooms.
  const items = list.data?.pages.flatMap((p) => p.data) ?? []
  const unread = items.filter((i) => i.unread)


  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const go = (item: InboxItem) => {
    if (item.unread) read.mutate({ inboxItemId: item.id, unread: false })
    setOpen(false)
    if (item.sourceType === 'task') {
      const task = tasks.find((t) => t.id === item.sourceId)
      if (task) onOpenTask(task.taskKey)
      else say('That task was deleted.')
    } else if (item.sourceType === 'conversation') {
      navigate(`/room/${item.sourceId}`)
    }
  }

  return (
    <div className="cal-foryou" ref={ref}>
      <button type="button" className="section-add-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        For you{unread.length ? <span className="cal-foryou-count" aria-label={`${unread.length} unread`}>{unread.length}</span> : null}
      </button>
      {open && (
        <div className="cal-menu cal-foryou-menu" role="dialog" aria-label="Notifications">
          <div className="cal-foryou-head">
            <span className="cal-menu-heading">Notifications</span>
            {unread.length > 0 && (
              <button type="button" className="cal-link-btn" onClick={() => unread.forEach((i) => read.mutate({ inboxItemId: i.id, unread: false }))}>Mark all read</button>
            )}
          </div>
          {list.isLoading ? <p className="cal-foryou-empty">Loading…</p>
            : items.length === 0 ? <p className="cal-foryou-empty">Nothing for you yet. You'll hear here when someone assigns you a task, mentions you, or a task you own is blocked or done.</p>
            : (
              <ul className="cal-foryou-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="cal-foryou-item" data-unread={item.unread || undefined} onClick={() => go(item)}>
                      <span className="cal-foryou-title">{item.title}</span>
                      <span className="cal-foryou-summary">{item.summary}</span>
                      <time dateTime={item.createdAt}>{since(item.createdAt)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          <label className="cal-foryou-email">
            <span>Also email me</span>
            <select
              value={saveSettings.isPending ? saveSettings.variables.email : settings.data?.email ?? 'direct'}
              disabled={!settings.data || saveSettings.isPending}
              onChange={(e) => saveSettings.mutate({ email: e.target.value as TaskNotificationSettings['email'] }, { onError: () => say("Couldn't save your email setting.") })}
            >
              <option value="direct">Mentions and assignments</option>
              <option value="all">Every notification</option>
              <option value="off">Nothing</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
