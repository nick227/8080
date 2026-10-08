import { useInboxItems, useInboxStream, useReadInboxItem } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { SectionHeader } from '../work/SectionHeader'
import { dayTitle, hourLabel } from './dates'
import { orderTasks, useCalendar } from './store'

export function CalendarToday({ today }: { today: string }) {
  const tasks = useCalendar((state) => state.tasks)
  const toggle = useCalendar((state) => state.toggle)
  const { workspace } = useCurrentWorkspace()
  const notifications = useInboxItems(workspace?.id, { unread: true })
  useInboxStream(workspace?.id)
  const read = useReadInboxItem(workspace?.id ?? '')
  const todayTasks = orderTasks(tasks.filter((task) => task.day === today))
  const items = notifications.data?.pages.flatMap((page) => page.data) ?? []

  return (
    <aside className="cal-today" aria-label="Today and notifications">
      <SectionHeader title="Today" />
      <p className="cal-today-date">{dayTitle(today)}</p>
      <section aria-label="Today's tasks">
        <div className="cal-surface-heading">
          <h3>Today's tasks</h3>
          <span>{todayTasks.filter((task) => task.status === 'open').length} open</span>
        </div>
        {todayTasks.length ? (
          <ul className="cal-surface-list">
            {todayTasks.map((task) => (
              <li key={task.id}>
                <label className="cal-today-task" data-done={task.status === 'done' || undefined}>
                  <input type="checkbox" checked={task.status === 'done'} onChange={() => toggle(task.id)} />
                  <span>{task.title}</span>
                  <time>{task.time ? hourLabel(task.time) : 'Anytime'}</time>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="work-quiet">No tasks for today. Add a task to get started.</p>}
      </section>
      <section aria-label="Notifications">
        <div className="cal-surface-heading"><h3>Notifications</h3><span>{items.length} unread</span></div>
        {notifications.isLoading ? <p className="work-quiet">Loading notifications…</p>
          : notifications.isError ? <p className="work-quiet">Notifications couldn't load. <button type="button" onClick={() => void notifications.refetch()}>Retry</button></p>
          : items.length ? (
            <ul className="cal-surface-list">
              {items.map((item) => (
                <li className="cal-notification" key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                  <button type="button" className="section-add-btn" disabled={read.isPending} onClick={() => read.mutate({ inboxItemId: item.id, unread: false })}>Mark read</button>
                </li>
              ))}
            </ul>
          ) : <p className="work-quiet">No new notifications.</p>}
        {read.isError && <p className="work-quiet" role="alert">Couldn't mark the notification as read. Please try again.</p>}
        {notifications.hasNextPage && <button className="section-add-btn" type="button" disabled={notifications.isFetchingNextPage} onClick={() => void notifications.fetchNextPage()}>Load more</button>}
      </section>
    </aside>
  )
}
