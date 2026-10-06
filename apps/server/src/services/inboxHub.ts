// Live fan-out for one member's inbox (doc/11). One process only. The stream
// also re-checks the table, so a missed push shows up within a couple of seconds.
import type { InboxItemView } from './inboxFanOut'

export type InboxEvent = { type: 'inbox.created'; item: InboxItemView }

type Send = (event: InboxEvent) => void

const subscribers = new Map<string, Set<Send>>()

export function publishInbox(memberId: string, event: InboxEvent) {
  const set = subscribers.get(memberId)
  if (!set) return
  for (const send of set) send(event)
}

export function subscribeInbox(memberId: string, send: Send) {
  let set = subscribers.get(memberId)
  if (!set) subscribers.set(memberId, set = new Set())
  set.add(send)
  return () => {
    set.delete(send)
    if (!set.size) subscribers.delete(memberId)
  }
}

/** Push now, or when deliverAt arrives. A far timer does not keep the process alive. */
export function releaseInbox(item: InboxItemView) {
  const wait = Date.parse(item.deliverAt) - Date.now()
  if (wait <= 0) {
    publishInbox(item.memberId, { type: 'inbox.created', item })
    return
  }
  const timer = setTimeout(() => publishInbox(item.memberId, { type: 'inbox.created', item }), wait)
  timer.unref?.()
}
