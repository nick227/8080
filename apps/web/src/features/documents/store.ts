import { create } from 'zustand'
import type { DocumentRecord } from './types'
import { starterDocs } from './seed'

const KEY = 'vc-documents'

type Status = 'Saved' | 'Unsynced'

type State = {
  docs: DocumentRecord[]
  ready: boolean
  openId: string | null
  status: Status
  ensure: (owner?: string) => void
  open: (id: string | null) => void
  add: (doc: DocumentRecord) => void
  change: (id: string, recipe: (doc: DocumentRecord) => DocumentRecord) => void
  remove: (id: string) => void
  linkRoom: (id: string, roomId: string) => void
  replaceIfNewer: (doc: DocumentRecord) => void
}

function read(): DocumentRecord[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isDoc)
  } catch {
    return null
  }
}

function isDoc(value: unknown): value is DocumentRecord {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return typeof doc.id === 'string' && typeof doc.title === 'string'
    && (doc.surface === 'blocks' || doc.surface === 'mental_map' || doc.surface === 'grid')
}

function write(docs: DocumentRecord[]): Status {
  try {
    localStorage.setItem(KEY, JSON.stringify(docs))
    return 'Saved'
  } catch {
    return 'Unsynced'
  }
}

export const useDocuments = create<State>((set, get) => ({
  docs: [],
  ready: false,
  openId: null,
  status: 'Saved',
  ensure(owner) {
    if (get().ready) return
    const stored = read()
    if (!stored && !owner) return
    const docs = stored ?? starterDocs(owner ?? 'You')
    set({ docs, ready: true, status: write(docs) })
  },
  open(id) {
    set({ openId: id })
  },
  add(doc) {
    const docs = [doc, ...get().docs]
    set({ docs, openId: doc.id, status: write(docs) })
  },
  change(id, recipe) {
    const docs = get().docs.map((doc) => doc.id === id ? recipe({ ...doc, updatedAt: Date.now() }) : doc)
    set({ docs, status: write(docs) })
  },
  remove(id) {
    const docs = get().docs.filter((doc) => doc.id !== id)
    set({ docs, openId: get().openId === id ? null : get().openId, status: write(docs) })
  },
  linkRoom(id, roomId) {
    get().change(id, (doc) => ({
      ...doc,
      roomIds: doc.roomIds.includes(roomId) ? doc.roomIds.filter((item) => item !== roomId) : [...doc.roomIds, roomId],
    }))
  },
  replaceIfNewer(doc) {
    const current = get().docs.find((item) => item.id === doc.id)
    if (current && current.updatedAt >= doc.updatedAt) return
    const docs = current ? get().docs.map((item) => item.id === doc.id ? doc : item) : [doc, ...get().docs]
    set({ docs, status: write(docs) })
  },
}))
