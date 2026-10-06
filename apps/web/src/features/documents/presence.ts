import { useEffect, useSyncExternalStore } from 'react'
import { useDocuments } from './store'
import type { DocumentRecord } from './types'

export type Activity = 'viewing' | 'editing' | 'idle'
export type Focus = { kind: 'block' | 'node' | 'edge' | 'cell'; id: string } | null
export type Drag = { nodeId: string; x: number; y: number; width: number; height: number }

export type Peer = {
  clientId: string
  name: string
  activity: Activity
  focus: Focus
  cursor: { x: number; y: number; space?: 'map' } | null
  drag: Drag | null
  seen: number
}

type StateMsg = {
  type: 'hello' | 'state' | 'leave'
  clientId: string
  docId: string
  name: string
  activity: Activity
  focus: Focus
  cursor: Peer['cursor']
  drag: Drag | null
}

type SnapshotMsg = { type: 'snapshot'; clientId: string; doc: DocumentRecord }

export const clientId = crypto.randomUUID()

let docId = ''
let name = 'You'
let activity: Activity = 'viewing'
let focus: Focus = null
let cursor: Peer['cursor'] = null
let drag: Drag | null = null
let peers: Peer[] = []
let channel: BroadcastChannel | null = null
let applying = false
let lastPost = 0
let pending = 0
let idleTimer = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function payload(type: StateMsg['type']): StateMsg {
  return { type, clientId, docId, name, activity, focus, cursor, drag }
}

function post(message: StateMsg | SnapshotMsg, force = false) {
  if (!channel) return
  const now = Date.now()
  if (!force && message.type === 'state' && now - lastPost < 40) {
    if (!pending) pending = window.setTimeout(() => { pending = 0; post(payload('state'), true) }, 40)
    return
  }
  lastPost = now
  channel.postMessage(message)
}

function upsert(peer: Peer) {
  peers = [...peers.filter((item) => item.clientId !== peer.clientId), peer]
  emit()
}

function onMessage(event: MessageEvent<StateMsg | SnapshotMsg>) {
  const message = event.data
  if (message.clientId === clientId || message.type === 'snapshot' && message.doc.id !== docId) return
  if (message.type === 'snapshot') {
    applying = true
    useDocuments.getState().replaceIfNewer(message.doc)
    applying = false
    return
  }
  if ('docId' in message && message.docId !== docId) return
  if (message.type === 'leave') {
    peers = peers.filter((item) => item.clientId !== message.clientId)
    emit()
    return
  }
  upsert({ ...message, seen: Date.now() })
  if (message.type === 'hello') post(payload('state'), true)
}

export function setPresenceName(next: string) {
  name = next || 'You'
}

export function joinDocument(nextDocId: string) {
  if (docId === nextDocId && channel) return
  leaveDocument()
  docId = nextDocId
  activity = 'viewing'
  focus = null
  cursor = null
  drag = null
  peers = []
  channel = new BroadcastChannel(`vc-doc:${nextDocId}`)
  channel.onmessage = onMessage
  post(payload('hello'), true)
  emit()
}

export function leaveDocument() {
  if (channel) post(payload('leave'), true)
  channel?.close()
  channel = null
  docId = ''
  peers = []
  emit()
}

export function notePresence(next: { activity?: Activity; focus?: Focus; cursor?: Peer['cursor']; drag?: Drag | null }) {
  if (next.activity) activity = next.activity
  if ('focus' in next) focus = next.focus ?? null
  if ('cursor' in next) cursor = next.cursor ?? null
  if ('drag' in next) drag = next.drag ?? null
  post(payload('state'))
  emit()
  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => {
    activity = 'idle'
    post(payload('state'), true)
    emit()
  }, 8000)
}

export function usePeers() {
  return useSyncExternalStore(subscribe, () => peers, () => peers)
}

export function useLocalActivity() {
  return useSyncExternalStore(subscribe, () => activity, () => activity)
}

export function useDocumentPresence(nextDocId: string, owner: string) {
  useEffect(() => {
    setPresenceName(owner)
    joinDocument(nextDocId)
    const timer = window.setInterval(() => {
      const now = Date.now()
      const live = peers.filter((peer) => now - peer.seen < 5000)
      if (live.length !== peers.length) {
        peers = live
        emit()
      }
    }, 1000)
    return () => {
      window.clearInterval(timer)
      leaveDocument()
    }
  }, [nextDocId, owner])
}

useDocuments.subscribe((state, prev) => {
  if (applying || !docId) return
  const doc = state.docs.find((item) => item.id === docId)
  const before = prev.docs.find((item) => item.id === docId)
  if (!doc || before?.updatedAt === doc.updatedAt) return
  post({ type: 'snapshot', clientId, doc }, true)
})
