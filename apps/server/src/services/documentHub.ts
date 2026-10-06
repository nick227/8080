// Live fan-out for shared native documents (doc/10 §10, POC): saves and presence
// reach every open stream of that document at once. One process only — the
// stream also re-checks the durable version, so a missed push (restart, another
// instance) is caught within a couple of seconds. Multi-server fan-out is later.

export type DocumentEvent =
  | { type: 'document.updated'; version: number; memberId: string | null; name: string | null }
  | { type: 'document.presence'; people: { memberId: string; name: string; editing: boolean }[] }

type Subscriber = { memberId: string; name: string; send: (event: DocumentEvent) => void }

const EDITING_TTL_MS = 4000

const subscribers = new Map<string, Set<Subscriber>>()
const editing = new Map<string, Map<string, number>>() // documentId → memberId → until
const expiry = new Map<string, ReturnType<typeof setTimeout>>()

function people(documentId: string) {
  const seen = new Map<string, { memberId: string; name: string; editing: boolean }>()
  const until = editing.get(documentId)
  const now = Date.now()
  for (const s of subscribers.get(documentId) ?? []) {
    seen.set(s.memberId, { memberId: s.memberId, name: s.name, editing: (until?.get(s.memberId) ?? 0) > now })
  }
  return [...seen.values()]
}

function broadcastPresence(documentId: string) {
  publish(documentId, { type: 'document.presence', people: people(documentId) })
}

export function publish(documentId: string, event: DocumentEvent) {
  for (const s of subscribers.get(documentId) ?? []) s.send(event)
}

export function subscribe(documentId: string, subscriber: Subscriber) {
  const set = subscribers.get(documentId) ?? new Set()
  set.add(subscriber)
  subscribers.set(documentId, set)
  broadcastPresence(documentId)
  return () => {
    set.delete(subscriber)
    if (!set.size) {
      subscribers.delete(documentId)
      editing.delete(documentId)
    }
    broadcastPresence(documentId)
  }
}

/** Marks someone as editing for a few seconds (renewed by each edit), or clears it. */
export function setEditing(documentId: string, memberId: string, on: boolean) {
  const map = editing.get(documentId) ?? new Map<string, number>()
  const was = (map.get(memberId) ?? 0) > Date.now()
  if (on) map.set(memberId, Date.now() + EDITING_TTL_MS)
  else map.delete(memberId)
  editing.set(documentId, map)
  if (was !== on) broadcastPresence(documentId)
  // Lapse: tell everyone when nobody has edited for a while.
  clearTimeout(expiry.get(`${documentId}:${memberId}`))
  if (on) {
    const timer = setTimeout(() => {
      expiry.delete(`${documentId}:${memberId}`)
      if ((editing.get(documentId)?.get(memberId) ?? 0) <= Date.now()) broadcastPresence(documentId)
    }, EDITING_TTL_MS + 50)
    timer.unref?.()
    expiry.set(`${documentId}:${memberId}`, timer)
  }
}
