// Live fan-out for one member's inbox (doc/11). One process only. The stream
// also re-checks the table, so a missed push shows up within a couple of seconds.
import type { InboxItemView, UserInboxItemView } from './inboxFanOut'
import { pushInboxItem } from './push'

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

/** Push now, or when deliverAt arrives. A far timer does not keep the process alive.
 *  The same moment goes to the member's devices as a Web Push (services/push.ts). */
export function releaseInbox(item: InboxItemView | UserInboxItemView) {
  const release = () => {
    // The workspace inbox stream carries workspace rows; a person's own rows go to their devices.
    if ('memberId' in item) publishInbox(item.memberId, { type: 'inbox.created', item })
    void pushInboxItem(item).catch((err) => console.warn('[push] skipped', (err as Error).message))
  }
  const wait = Date.parse(item.deliverAt) - Date.now()
  if (wait <= 0) {
    release()
    return
  }
  const timer = setTimeout(release, wait)
  timer.unref?.()
}
