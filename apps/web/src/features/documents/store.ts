import { create } from 'zustand'
import { documentsApi, getApiClient, unwrap, type Document as ServerDocument } from '@project/sdk'
import type { DocumentRecord, NativeSheet, SharedInfo } from './types'
import { starterDocs } from './seed'
import { attachBlocks, attachSheet, blocksChanged, detachBlocks, isAttached } from './liveBlocks'
import { fromContent, toContent } from './sheetModel'

// The Documents list. With a workspace, entries come from the shared server
// registry (identity, title, owner, sharing, room links, deletion — doc/10 §3);
// without one (guests, or before a workspace exists) it is this browser's own list.
//
// Content is NOT part of this slice: block, map and blank-sheet content stays in
// this browser, keyed by the registry id, until native persistence lands
// (doc/10 §10). Contacts views read live records, imported sheets read their
// rows from the server, Google links open Google. The status line says which.
//
// The interface (docs, open, add, change, remove, linkRoom, status, ensure,
// replaceIfNewer) is what the list, header, shell and editors already use.

const LOCAL_KEY = 'vc-documents'
const contentKey = (workspaceId: string) => `vc-doc-content:${workspaceId}`
const adoptedKey = (workspaceId: string) => `vc-doc-adopted:${workspaceId}`
const STARTER_IDS = new Set(['doc-brief', 'doc-map', 'doc-plan', 'doc-contacts'])
const REFRESH_MS = 10_000
const CONTACTS_QUERY = { columns: ['id', 'displayName', 'title', 'primaryEmail'] as ('id' | 'displayName' | 'title' | 'primaryEmail')[] }

type Content = Pick<DocumentRecord, 'blocks' | 'nodes' | 'edges' | 'sheet'> & { updatedAt: number }
type Mode = 'starting' | 'local' | 'shared'
type Grant = { memberId: string; role: 'viewer' | 'editor' }
export type Member = { id: string; name: string }

type State = {
  docs: DocumentRecord[]
  ready: boolean
  openId: string | null
  status: string
  mode: Mode
  workspaceId: string | null
  members: Member[]
  // This person's workspace member id (presence: "me" vs others)
  me: string | null
  ensure: (owner?: string) => void
  open: (id: string | null) => void
  add: (doc: DocumentRecord) => void
  change: (id: string, recipe: (doc: DocumentRecord) => DocumentRecord) => void
  remove: (id: string) => void
  linkRoom: (id: string, roomId: string) => void
  replaceIfNewer: (doc: DocumentRecord) => void
  // Registry actions for the list/header UI to wire (workspace mode only)
  refresh: () => Promise<void>
  grants: (id: string) => Promise<Grant[]>
  share: (id: string, memberId: string, role: Grant['role'] | null) => Promise<void>
  // The whole workspace's access (null = private to the owner and grants)
  shareWithWorkspace: (id: string, role: Grant['role'] | null) => Promise<void>
  listDeleted: () => Promise<DocumentRecord[]>
  restore: (id: string) => Promise<void>
  related: (id: string) => Promise<DocumentRecord[]>
  relate: (id: string, otherId: string, remove?: boolean) => Promise<void>
  addGoogleLink: (title: string, url: string) => Promise<DocumentRecord | null>
  importCsv: (title: string, csv: string, filename: string) => Promise<DocumentRecord | null>
}

// ─── browser storage ─────────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function isDoc(value: unknown): value is DocumentRecord {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return typeof doc.id === 'string' && typeof doc.title === 'string'
    && (doc.surface === 'blocks' || doc.surface === 'mental_map' || doc.surface === 'grid')
}

const readLocal = () => {
  const parsed = readJson<unknown>(LOCAL_KEY, null)
  return Array.isArray(parsed) ? parsed.filter(isDoc) : null
}

const contentOf = (doc: DocumentRecord): Content => ({ blocks: doc.blocks, nodes: doc.nodes, edges: doc.edges, sheet: doc.sheet?.mode === 'sheet' ? doc.sheet : undefined, updatedAt: doc.updatedAt })

// ─── server mapping ──────────────────────────────────────────────────────────

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong')
const isConflict = (error: unknown) => (error as { code?: string })?.code === 'DOCUMENT_VERSION_CONFLICT'

function descriptorFor(doc: DocumentRecord) {
  if (doc.sheet?.mode === 'dataset') {
    return { surface: 'grid' as const, source: { kind: 'dataset' as const, datasetKey: 'contacts' as const, datasetVersion: 1 as const, query: CONTACTS_QUERY } }
  }
  return { surface: doc.surface as 'blocks' | 'mental_map' | 'grid', source: { kind: 'native' as const, schemaVersion: 1 as const } }
}

const emptySheet = (): NativeSheet => ({ mode: 'sheet', columns: [], rows: [] })

type Context = { members: Map<string, string>; me: string | null; rooms: Map<string, string[]>; content: Record<string, Content>; imported: Map<string, NativeSheet> }

function toRecord(s: ServerDocument, ctx: Context): DocumentRecord {
  const d = s.descriptor
  const kind: SharedInfo['kind'] = d.source.kind === 'dataset' ? 'dataset' : d.source.kind === 'external' ? 'external' : s.capabilities.readMaterialization ? 'imported' : 'native'
  const local = ctx.content[s.id]
  const shared: SharedInfo = {
    version: s.version,
    ownerMemberId: s.ownerMemberId,
    kind,
    mine: s.ownerMemberId === ctx.me,
    canEdit: s.capabilities.editMetadata,
    canManage: s.capabilities.manageAccess,
    externalUrl: d.source.kind === 'external' ? d.source.url : undefined,
    externalFileId: s.externalFileId,
    generated: (s.provenance as { kind?: string } | null)?.kind === 'artifact',
  }
  const base: DocumentRecord = {
    id: s.id,
    title: s.title,
    surface: d.surface,
    ownerName: ctx.members.get(s.ownerMemberId) ?? 'Someone',
    updatedAt: Math.max(Date.parse(s.updatedAt), local?.updatedAt ?? 0),
    roomIds: ctx.rooms.get(s.id) ?? [],
    shared,
  }
  if (kind === 'dataset') return { ...base, sheet: { mode: 'dataset', dataset: 'contacts', columns: ['name', 'title', 'email'] } }
  if (kind === 'external') return base
  if (kind === 'imported') return { ...base, sheet: local?.sheet ?? ctx.imported.get(s.id) ?? emptySheet() }
  // Native: this browser's content, or a blank one (another person's content isn't shared yet).
  if (d.surface === 'blocks') return { ...base, blocks: local?.blocks ?? [] }
  if (d.surface === 'mental_map') return { ...base, nodes: local?.nodes ?? [], edges: local?.edges ?? [] }
  return { ...base, sheet: local?.sheet ?? emptySheet() }
}

export function statusFor(doc: DocumentRecord | undefined, mode: Mode): string {
  if (!doc) return ''
  if (mode !== 'shared' || !doc.shared) return 'Saved on this device · join a workspace to share'
  switch (doc.shared.kind) {
    case 'dataset': return 'Live data · edits update contacts'
    case 'external': return 'Opens in Google'
    case 'imported': return 'Shared · live'
    // Block documents and sheets are shared and live (liveBlocks.ts); maps not yet.
    case 'native': if (doc.surface === 'blocks' || doc.surface === 'grid') return 'Shared · live'
      return doc.shared.mine ? 'Content saved on this device only · not shared yet' : 'Content stays on its owner’s device until shared editing'
  }
}

// ─── store ───────────────────────────────────────────────────────────────────

let starting: Promise<void> | null = null
let timer: number | undefined
const renameTimers = new Map<string, number>()
const pendingTitles = new Map<string, string>()
const importedRows = new Map<string, NativeSheet>()

export const useDocuments = create<State>((set, get) => {
  const ws = () => get().workspaceId!

  function saveContent(doc: DocumentRecord) {
    if (get().mode !== 'shared') return writeJson(LOCAL_KEY, get().docs)
    const all = readJson<Record<string, Content>>(contentKey(ws()), {})
    all[doc.id] = contentOf(doc)
    return writeJson(contentKey(ws()), all)
  }

  function setDocs(docs: DocumentRecord[], extra: Partial<State> = {}) {
    const open = docs.find((d) => d.id === get().openId)
    set({ docs, ...extra, status: extra.status ?? statusFor(open, extra.mode ?? get().mode) })
    // Opened (e.g. from a channel link) before the list knew it: start syncing it now.
    if (open) attachOpen(open)
  }

  // Shared content syncs live while open: block documents (liveBlocks) and native
  // sheets — blank, imported or generated (typed cells, doc/13 A2).
  function attachOpen(doc: DocumentRecord) {
    if (get().mode !== 'shared' || !doc.shared || isAttached(doc.id) || get().openId !== doc.id) return
    const docId = doc.id
    const status = (text: string) => { if (get().openId === docId) set({ status: text }) }
    if (doc.surface === 'blocks' && doc.shared.kind === 'native') {
      attachBlocks(ws(), docId, {
        blocks: () => get().docs.find((d) => d.id === docId)?.blocks,
        apply: (blocks) => set({ docs: get().docs.map((d) => (d.id === docId ? { ...d, blocks } : d)) }),
        status, canEdit: doc.shared.canEdit, me: get().me,
      })
    } else if (doc.surface === 'grid' && (doc.shared.kind === 'native' || doc.shared.kind === 'imported') && doc.sheet?.mode !== 'dataset') {
      attachSheet(ws(), docId, {
        get: () => { const d = get().docs.find((x) => x.id === docId); return d?.sheet?.mode === 'sheet' ? toContent(d.sheet) : undefined },
        apply: (content) => set({ docs: get().docs.map((d) => (d.id === docId ? { ...d, sheet: fromContent(content) } : d)) }),
        status, canEdit: doc.shared.canEdit, me: get().me,
      })
    }
  }

  function startLocal(owner?: string) {
    const docs = readLocal() ?? starterDocs(owner ?? 'You')
    writeJson(LOCAL_KEY, docs)
    setDocs(docs, { ready: true, mode: 'local', workspaceId: null })
  }

  async function loadShared(workspaceId: string, me: string | null, members: Map<string, string>) {
    const rows: ServerDocument[] = []
    let cursor: string | undefined
    do {
      const page = await documentsApi.list(workspaceId, { limit: 100, cursor })
      rows.push(...page.data)
      cursor = page.meta.nextCursor ?? undefined
    } while (cursor && rows.length < 300)
    const rooms = new Map(await Promise.all(rows.map(async (r) => [r.id, (await documentsApi.rooms(workspaceId, r.id)).map((l) => l.roomId)] as const)))
    const ctx: Context = { members, me, rooms, content: readJson(contentKey(workspaceId), {}), imported: importedRows }
    return rows.map((r) => {
      const record = toRecord(r, ctx)
      const pending = pendingTitles.get(r.id)
      return pending !== undefined ? { ...record, title: pending } : record
    })
  }

  // Local documents made before the workspace existed join it once; starter
  // documents are created for the workspace owner only (others see what's shared).
  async function adopt(workspaceId: string, isOwner: boolean, visible: number, owner: string) {
    const adopted = readJson<Record<string, string>>(adoptedKey(workspaceId), {})
    const local = readLocal() ?? []
    const content = readJson<Record<string, Content>>(contentKey(workspaceId), {})
    const candidates = local.filter((d) => !adopted[d.id] && (!STARTER_IDS.has(d.id) || (isOwner && visible === 0)))
    if (isOwner && visible === 0 && !local.some((d) => STARTER_IDS.has(d.id))) candidates.push(...starterDocs(owner).filter((d) => !adopted[d.id]))
    for (const doc of candidates) {
      const created = await documentsApi.create(workspaceId, { title: doc.title, descriptor: descriptorFor(doc), idempotencyKey: `adopt:${workspaceId}:${doc.id}` })
      adopted[doc.id] = created.id
      if (doc.sheet?.mode !== 'dataset') content[created.id] = contentOf(doc)
    }
    writeJson(contentKey(workspaceId), content)
    writeJson(adoptedKey(workspaceId), adopted)
    return candidates.length
  }

  async function startShared(owner: string) {
    const workspaces = unwrap(await getApiClient().GET('/workspaces')).data
    const workspace = workspaces[0]
    if (!workspace) return false
    const memberRows = unwrap(await getApiClient().GET('/workspaces/{workspaceId}/members', { params: { path: { workspaceId: workspace.id } } })).data
    const me = unwrap(await getApiClient().GET('/auth/me')).data
    const mine = memberRows.find((m) => m.user.id === me.id)?.id ?? null
    const members = new Map(memberRows.map((m) => [m.id, m.user.name]))
    set({ workspaceId: workspace.id, members: memberRows.map((m) => ({ id: m.id, name: m.user.name })) })
    let docs = await loadShared(workspace.id, mine, members)
    if (await adopt(workspace.id, workspace.role === 'owner', docs.length, owner)) docs = await loadShared(workspace.id, mine, members)
    // A document open while the list switched to the workspace stays open under its registry id.
    const openId = get().openId
    const adoptedId = openId ? readJson<Record<string, string>>(adoptedKey(workspace.id), {})[openId] : undefined
    set({ openId: adoptedId ?? (docs.some((d) => d.id === openId) ? openId : null) })
    setDocs(docs, { ready: true, mode: 'shared' })
    context = { me: mine, members }
    set({ me: mine })
    return true
  }

  let context: { me: string | null; members: Map<string, string> } = { me: null, members: new Map() }

  async function rename(id: string) {
    const title = pendingTitles.get(id)
    const doc = get().docs.find((d) => d.id === id)
    if (title === undefined || !doc?.shared) return
    set({ status: 'Saving title…' })
    try {
      let saved: ServerDocument
      try {
        saved = await documentsApi.update(ws(), id, { expectedVersion: doc.shared.version, title })
      } catch (error) {
        if (!isConflict(error)) throw error
        // Someone else changed the entry meanwhile: apply this rename on top of it.
        const latest = await documentsApi.get(ws(), id)
        saved = await documentsApi.update(ws(), id, { expectedVersion: latest.version, title })
      }
      if (pendingTitles.get(id) === title) pendingTitles.delete(id)
      patchShared(id, { version: saved.version })
      set({ status: 'Saved' })
    } catch (error) {
      set({ status: `Couldn’t save the title — ${errorText(error)}` })
    }
  }

  function patchShared(id: string, patch: Partial<SharedInfo>, extra: Partial<DocumentRecord> = {}) {
    set({ docs: get().docs.map((d) => (d.id === id && d.shared ? { ...d, ...extra, shared: { ...d.shared, ...patch } } : d)) })
  }

  async function serverRecord(s: ServerDocument) {
    const rooms = new Map([[s.id, (await documentsApi.rooms(ws(), s.id)).map((l) => l.roomId)]])
    return toRecord(s, { ...context, rooms, content: readJson(contentKey(ws()), {}), imported: importedRows })
  }

  return {
    docs: [],
    ready: false,
    openId: null,
    status: '',
    mode: 'starting',
    workspaceId: null,
    members: [],
    me: null,

    ensure(owner) {
      if (get().ready || starting) return
      const name = owner ?? 'You'
      starting = (async () => {
        try {
          if (!(await startShared(name))) startLocal(owner)
        } catch {
          startLocal(owner) // offline or signed out: this browser's list still works
        } finally {
          starting = null
        }
        if (timer === undefined && typeof window !== 'undefined') {
          timer = window.setInterval(() => void get().refresh(), REFRESH_MS)
          window.addEventListener('focus', () => void get().refresh())
        }
      })()
    },

    async refresh() {
      if (starting || get().mode === 'starting') return
      try {
        if (get().mode === 'local') {
          // A workspace may have been created meanwhile (e.g. from the Contacts grid).
          if (await startShared('You')) return
          return
        }
        const docs = await loadShared(ws(), context.me, context.members)
        // An open, live document keeps its synced content (not the device copy).
        const current = new Map(get().docs.map((d) => [d.id, d]))
        setDocs(docs.map((d) => (isAttached(d.id) ? { ...d, blocks: current.get(d.id)?.blocks ?? d.blocks, sheet: current.get(d.id)?.sheet ?? d.sheet } : d)))
      } catch {
        // keep showing what we have; the next tick retries
      }
    },

    open(id) {
      const doc = id ? get().docs.find((d) => d.id === id) : undefined
      if (doc?.surface === 'external') {
        // Google controls the file; we only hold the link (doc/10 §3).
        if (doc.shared?.externalUrl) window.open(doc.shared.externalUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const previous = get().openId
      if (previous && previous !== id) detachBlocks(previous)
      set({ openId: id, status: statusFor(doc, get().mode) })
      if (doc) attachOpen(doc)
    },

    add(doc) {
      if (get().mode !== 'shared') {
        const docs = [doc, ...get().docs]
        set({ docs, openId: doc.id, status: writeJson(LOCAL_KEY, docs) ? statusFor(doc, 'local') : 'Unsynced' })
        return
      }
      // Shown at once; becomes the registry entry when the server answers.
      set({ docs: [doc, ...get().docs], openId: doc.id, status: 'Creating…' })
      void documentsApi.create(ws(), { title: doc.title, descriptor: descriptorFor(doc), idempotencyKey: doc.id })
        .then(async (created) => {
          const withContent = { ...doc, id: created.id }
          saveContent(withContent)
          const record = await serverRecord(created)
          set({
            docs: get().docs.map((d) => (d.id === doc.id ? record : d)),
            openId: get().openId === doc.id ? created.id : get().openId,
            status: statusFor(record, 'shared'),
          })
        })
        .catch((error) => set({ docs: get().docs.filter((d) => d.id !== doc.id), openId: null, status: `Couldn’t create — ${errorText(error)}` }))
    },

    change(id, recipe) {
      const before = get().docs.find((d) => d.id === id)
      if (!before) return
      const next = recipe({ ...before, updatedAt: Date.now() })
      const docs = get().docs.map((d) => (d.id === id ? next : d))
      set({ docs })
      if (get().mode !== 'shared') {
        set({ status: writeJson(LOCAL_KEY, docs) ? statusFor(next, 'local') : 'Unsynced' })
        return
      }
      // Content → this browser; the title → the shared registry (debounced, versioned).
      if (blocksChanged(id)) {
        // live block document: saved to the shared content (liveBlocks.ts)
      } else if (!saveContent(next)) set({ status: 'Unsynced on this device' })
      if (next.title !== before.title && next.shared) {
        pendingTitles.set(id, next.title)
        window.clearTimeout(renameTimers.get(id))
        renameTimers.set(id, window.setTimeout(() => void rename(id), 500))
      }
    },

    remove(id) {
      const doc = get().docs.find((d) => d.id === id)
      if (!doc) return
      detachBlocks(id)
      const docs = get().docs.filter((d) => d.id !== id)
      const openId = get().openId === id ? null : get().openId
      if (get().mode !== 'shared' || !doc.shared) {
        set({ docs, openId, status: writeJson(LOCAL_KEY, docs) ? 'Saved' : 'Unsynced' })
        return
      }
      set({ docs, openId })
      // Moves to trash for everyone it's shared with; restore brings it back.
      void documentsApi.remove(ws(), id, doc.shared.version).catch((error) => {
        set({ docs: [doc, ...get().docs], status: `Couldn’t delete — ${errorText(error)}` })
      })
    },

    linkRoom(id, roomId) {
      const doc = get().docs.find((d) => d.id === id)
      if (!doc) return
      const linked = doc.roomIds.includes(roomId)
      const roomIds = linked ? doc.roomIds.filter((r) => r !== roomId) : [...doc.roomIds, roomId]
      set({ docs: get().docs.map((d) => (d.id === id ? { ...d, roomIds } : d)) })
      if (get().mode !== 'shared' || !doc.shared) {
        writeJson(LOCAL_KEY, get().docs)
        return
      }
      const call = linked ? documentsApi.unlinkRoom(ws(), id, roomId) : documentsApi.linkRoom(ws(), id, roomId)
      void call.catch((error) => {
        set({ docs: get().docs.map((d) => (d.id === id ? { ...d, roomIds: doc.roomIds } : d)), status: `Couldn’t change the room link — ${errorText(error)}` })
      })
    },

    // Another tab of this browser changed a document (presence.ts): content and
    // title arrive here; that tab already saved them.
    replaceIfNewer(doc) {
      const current = get().docs.find((item) => item.id === doc.id)
      if (current && current.updatedAt >= doc.updatedAt) return
      const merged = current?.shared ? { ...doc, shared: current.shared, roomIds: current.roomIds } : doc
      const docs = current ? get().docs.map((item) => (item.id === doc.id ? merged : item)) : [merged, ...get().docs]
      set({ docs })
      if (get().mode !== 'shared') writeJson(LOCAL_KEY, docs)
    },

    async grants(id) {
      return (await documentsApi.grants(ws(), id)).map((g) => ({ memberId: g.memberId, role: g.role }))
    },

    async share(id, memberId, role) {
      if (role) await documentsApi.setGrant(ws(), id, memberId, role)
      else await documentsApi.removeGrant(ws(), id, memberId)
    },

    async shareWithWorkspace(id, role) {
      await documentsApi.setWorkspaceAccess(ws(), id, role)
      await get().refresh() // capabilities follow the new audience
    },

    async listDeleted() {
      const page = await documentsApi.list(ws(), { deleted: true, limit: 100 })
      return Promise.all(page.data.map(serverRecord))
    },

    async restore(id) {
      const doc = await documentsApi.get(ws(), id)
      const restored = await documentsApi.restore(ws(), id, doc.version)
      const record = await serverRecord(restored)
      set({ docs: [record, ...get().docs.filter((d) => d.id !== id)] })
    },

    async related(id) {
      const relations = await documentsApi.related(ws(), id)
      return Promise.all(relations.map((r) => serverRecord(r.document)))
    },

    async relate(id, otherId, remove = false) {
      if (remove) await documentsApi.unrelate(ws(), id, otherId)
      else await documentsApi.relate(ws(), id, otherId)
    },

    async addGoogleLink(title, url) {
      if (get().mode !== 'shared') return null
      const provider = url.includes('/spreadsheets/') ? 'google_sheets' as const : 'google_docs' as const
      const created = await documentsApi.create(ws(), { title, idempotencyKey: crypto.randomUUID(), descriptor: { surface: 'external', source: { kind: 'external', provider, url } } })
      const record = await serverRecord(created)
      set({ docs: [record, ...get().docs] })
      return record
    },

    // An ordinary spreadsheet import: a new sheet, no contacts created (doc/10 §7A).
    async importCsv(title, csv, filename) {
      if (get().mode !== 'shared') return null
      const created = await documentsApi.importCsv(ws(), { title, csv, filename, idempotencyKey: crypto.randomUUID() })
      const record = await serverRecord(created)
      set({ docs: [record, ...get().docs] })
      return record
    },
  }
})

