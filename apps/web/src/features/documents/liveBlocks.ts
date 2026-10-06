import { create } from 'zustand'
import { ApiError, documentContentApi } from '@project/sdk'
import type { SheetContent } from '@project/shared'
import type { Block } from './types'
import { rebaseSheet } from './sheetModel'

// Shared content for block documents (doc/10 §10, minimal POC) and native sheets
// (doc/13 A2; cells merged one by one, see sheetModel.rebaseSheet). The server holds
// the content with a version; this module keeps one open document in sync:
//  - load it, and open its event stream (updates + who's here / editing);
//  - save local edits ~300 ms after typing pauses, based on a version;
//  - when someone else saved first (409, or a pushed update), rebase this
//    browser's changed blocks onto the latest and save again.
// Concurrent edits to different blocks both survive. If both people changed the
// same block, theirs is kept and this browser says so — never a silent overwrite.
// Not here (by design): CRDT, offline, reorder merging, undo, history.

export type Person = { memberId: string; name: string; editing: boolean }

type Hooks = {
  blocks: () => Block[] | undefined
  apply: (blocks: Block[]) => void
  status: (text: string) => void
  canEdit: boolean
  me: string | null
}

// What differs between content kinds (blocks, sheets); the session is the same.
type Kind<T> = {
  read: (content: unknown) => T | null
  empty: T
  isEmpty: (content: T) => boolean
  /** Local edits since `base` onto `remote`; conflicts are reported by `conflicted`. */
  merge: (base: T, local: T, remote: T) => { merged: T; conflicts: number }
  conflicted: (s: Session<T>, base: T, local: T, remote: T, by: string) => string
}
type ContentHooks<T> = { get: () => T | undefined; apply: (content: T) => void; status: (text: string) => void; canEdit: boolean; me: string | null }

type Session<T = unknown> = {
  workspaceId: string
  documentId: string
  hooks: ContentHooks<T>
  kind: Kind<T>
  baseVersion: number
  base: T
  dirty: boolean
  timer?: number
  retry?: number
  queue: Promise<void>
  source: EventSource | null
  lastPing: number
  lastRemoteName: string | null
  // A conflict message stays visible until this person edits again.
  conflict: string | null
  closed: boolean
}

const SAVE_DELAY_MS = 300
const PING_MS = 1500

export const usePresence = create<{ people: Record<string, Person[]> }>(() => ({ people: {} }))

// Text this person lost to a same-block conflict, kept until they use or dismiss it
// (also across a refresh) — the other person's text won, but nothing is gone.
export type Recovered = { id: string; blockId: string; text: string; by: string; at: number }
const recoveryKey = (documentId: string) => `vc-doc-recovery:${documentId}`
function readRecovered(documentId: string): Recovered[] {
  try {
    const raw = localStorage.getItem(recoveryKey(documentId))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as Recovered[]) : []
  } catch {
    return []
  }
}
export const useRecovery = create<{ items: Record<string, Recovered[]> }>(() => ({ items: {} }))
function saveRecovered(documentId: string, items: Recovered[]) {
  useRecovery.setState((s) => ({ items: { ...s.items, [documentId]: items } }))
  try { localStorage.setItem(recoveryKey(documentId), JSON.stringify(items)) } catch { /* kept in memory */ }
}
export function recovered(documentId: string) {
  return useRecovery.getState().items[documentId] ?? readRecovered(documentId)
}
export function dismissRecovered(documentId: string, id: string) {
  saveRecovered(documentId, recovered(documentId).filter((item) => item.id !== id))
}
const setPeople = (documentId: string, people: Person[]) => usePresence.setState((s) => ({ people: { ...s.people, [documentId]: people } }))

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Three-way merge by block id: `base` is the version the local edits started
 * from. Remote order wins (reordering isn't merged in this POC).
 */
export function rebase(base: Block[], local: Block[], remote: Block[]) {
  const B = new Map(base.map((b) => [b.id, b]))
  const L = new Map(local.map((b) => [b.id, b]))
  const R = new Map(remote.map((b) => [b.id, b]))
  const conflicts: string[] = []
  const merged: Block[] = []
  for (const r of remote) {
    const b = B.get(r.id)
    const l = L.get(r.id)
    if (!b) { merged.push(r); continue } // added by them
    if (!l) { // deleted here
      if (same(b, r)) continue
      merged.push(r); conflicts.push(r.id) // …but they changed it: keep theirs
      continue
    }
    if (same(l, b) || same(l, r)) { merged.push(r); continue } // not changed here
    if (same(r, b)) { merged.push(l); continue } // changed only here
    merged.push(r); conflicts.push(r.id) // both changed the same block: keep theirs
  }
  // Changed here but deleted by them: theirs wins, reported.
  for (const l of local) if (B.has(l.id) && !R.has(l.id) && !same(l, B.get(l.id))) conflicts.push(l.id)
  // Added here: after the nearest preceding block that survived.
  local.forEach((l, i) => {
    if (B.has(l.id) || R.has(l.id)) return
    const prev = local.slice(0, i).reverse().find((p) => merged.some((m) => m.id === p.id))
    merged.splice(prev ? merged.findIndex((m) => m.id === prev.id) + 1 : 0, 0, l)
  })
  return { merged, conflicts }
}

const sessions = new Map<string, Session<any>>()

function enqueue(s: Session<any>, task: () => Promise<void>) {
  s.queue = s.queue.then(task, task).catch(() => {})
  return s.queue
}

async function pull<T>(s: Session<T>) {
  const latest = await documentContentApi.get(s.workspaceId, s.documentId)
  if (s.closed || latest.version <= s.baseVersion) return
  const remote = s.kind.read(latest.content) ?? s.kind.empty
  const local = s.hooks.get() ?? s.kind.empty
  const base = s.base
  const { merged, conflicts } = s.kind.merge(base, local, remote)
  s.base = remote
  s.baseVersion = latest.version
  s.hooks.apply(merged)
  if (!same(merged, remote)) {
    s.dirty = true
    schedule(s)
  }
  if (conflicts) {
    s.conflict = s.kind.conflicted(s, base, local, remote, latest.updatedBy?.name ?? s.lastRemoteName ?? 'Someone')
    s.hooks.status(s.conflict)
  }
}

async function flush<T>(s: Session<T>, final = false) {
  if ((s.closed && !final) || !s.dirty || !s.hooks.canEdit) return
  s.dirty = false
  const content = (s.hooks.get() ?? s.kind.empty) as never
  s.hooks.status('Saving…')
  try {
    const saved = await documentContentApi.save(s.workspaceId, s.documentId, { expectedVersion: s.baseVersion, content })
    s.base = s.kind.read(saved.content) ?? s.kind.empty
    s.baseVersion = saved.version
    if (!s.dirty) s.hooks.status(s.conflict ?? 'Saved · shared')
  } catch (error) {
    if (error instanceof ApiError && error.code === 'DOCUMENT_CONTENT_CONFLICT') {
      // Someone saved first: rebase onto theirs; save again only if changes remain.
      try {
        await pull(s)
      } catch {
        s.dirty = true
      }
      if (s.dirty) schedule(s, 0)
      return
    }
    s.dirty = true
    s.hooks.status('Couldn’t save — retrying')
    window.clearTimeout(s.retry)
    s.retry = window.setTimeout(() => schedule(s, 0), 2000)
  }
}

function schedule(s: Session<any>, delay = SAVE_DELAY_MS) {
  window.clearTimeout(s.timer)
  s.timer = window.setTimeout(() => void enqueue(s, () => flush(s)), delay)
}

const BLOCKS: Kind<Block[]> = {
  read: (content) => (Array.isArray(content) ? (content as Block[]) : null),
  empty: [],
  isEmpty: (blocks) => !blocks.length,
  merge: (base, local, remote) => { const r = rebase(base, local, remote); return { merged: r.merged, conflicts: r.conflicts.length } },
  conflicted: (s, base, local, remote, by) => {
    // Keep what this person wrote in the contested blocks, for recovery.
    const { conflicts } = rebase(base, local, remote)
    const lost = conflicts.flatMap((blockId) => {
      const mine = local.find((b) => b.id === blockId)?.text
      const theirs = remote.find((b) => b.id === blockId)?.text
      return mine && mine !== theirs ? [{ id: crypto.randomUUID(), blockId, text: mine, by, at: Date.now() }] : []
    })
    if (lost.length) saveRecovered(s.documentId, [...recovered(s.documentId), ...lost])
    return `Conflict · ${by} changed the same block — kept their text`
  },
}

const SHEETS: Kind<SheetContent> = {
  read: (content) => (content && typeof content === 'object' && !Array.isArray(content) ? (content as SheetContent) : null),
  empty: { schemaVersion: 1, columns: [], rows: [] },
  isEmpty: (sheet) => !sheet.columns.length && !sheet.rows.length,
  merge: rebaseSheet,
  conflicted: (_s, base, local, remote, by) => {
    const n = rebaseSheet(base, local, remote).conflicts
    return `Conflict · ${by} changed ${n === 1 ? 'a cell you changed' : `${n} cells you changed`} — kept their values`
  },
}

function attach<T>(workspaceId: string, documentId: string, hooks: ContentHooks<T>, kind: Kind<T>) {
  detachBlocks(documentId)
  const s: Session<T> = { workspaceId, documentId, hooks, kind, baseVersion: 0, base: kind.empty, dirty: false, queue: Promise.resolve(), source: null, lastPing: 0, lastRemoteName: null, conflict: null, closed: false }
  sessions.set(documentId, s)
  useRecovery.setState((st) => ({ items: { ...st.items, [documentId]: readRecovered(documentId) } }))

  void enqueue(s, async () => {
    const first = await documentContentApi.get(workspaceId, documentId)
    if (s.closed) return
    const server = kind.read(first.content)
    if (first.version === 0) {
      // Nothing saved yet. A sheet may start from its import or recipe snapshot; this
      // browser's (device-local) content, if any, becomes version 1.
      s.base = server ?? kind.empty
      const local = hooks.get()
      if (hooks.canEdit && local && !kind.isEmpty(local) && !same(local, s.base)) { s.dirty = true; schedule(s, 0) }
      else if (server) hooks.apply(server)
      hooks.status(hooks.canEdit ? 'Shared · live' : server ? 'Shared · read only' : 'Shared · nothing written yet')
      return
    }
    s.base = server ?? kind.empty
    s.baseVersion = first.version
    hooks.apply(s.base)
    hooks.status('Shared · live')
  }).catch(() => hooks.status('Couldn’t load the shared content'))

  const source = new EventSource(documentContentApi.streamUrl(workspaceId, documentId), { withCredentials: true })
  s.source = source
  source.addEventListener('document.updated', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { version: number; memberId: string | null; name: string | null }
    if (data.memberId && data.memberId !== hooks.me) s.lastRemoteName = data.name
    if (data.version > s.baseVersion) void enqueue(s, () => pull(s))
  })
  source.addEventListener('document.presence', (event) => {
    setPeople(documentId, (JSON.parse((event as MessageEvent).data) as { people: Person[] }).people)
  })
  return () => detachBlocks(documentId)
}

/** Start syncing an open block document. Returns a detach function. */
export function attachBlocks(workspaceId: string, documentId: string, hooks: Hooks) {
  return attach(workspaceId, documentId, { get: hooks.blocks, apply: hooks.apply, status: hooks.status, canEdit: hooks.canEdit, me: hooks.me }, BLOCKS)
}

/** Start syncing an open native sheet (typed cells, doc/13 A2). Returns a detach function. */
export function attachSheet(workspaceId: string, documentId: string, hooks: ContentHooks<SheetContent>) {
  return attach(workspaceId, documentId, hooks, SHEETS)
}

export function detachBlocks(documentId: string) {
  const s = sessions.get(documentId)
  if (!s) return
  // Leaving with unsaved edits: send them now (best effort).
  if (s.dirty) void enqueue(s, () => flush(s, true))
  s.closed = true
  window.clearTimeout(s.timer)
  window.clearTimeout(s.retry)
  s.source?.close()
  sessions.delete(documentId)
  setPeople(documentId, [])
}

/** A local edit of an attached document: save soon, and tell others "editing". */
export function blocksChanged(documentId: string) {
  const s = sessions.get(documentId)
  if (!s) return false
  s.dirty = true
  s.conflict = null
  schedule(s)
  if (Date.now() - s.lastPing > PING_MS) {
    s.lastPing = Date.now()
    void documentContentApi.presence(s.workspaceId, s.documentId, true).catch(() => {})
  }
  return true
}

export const isAttached = (documentId: string) => sessions.has(documentId)
