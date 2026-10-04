import { create } from 'zustand'
import { STOCK_IMAGES } from '../features/edit/stock'

// The camera background chosen while framing (features/virtualCamera.ts draws it).
// Mode + stock photo persist in localStorage; the user's own photo is a Blob in
// IndexedDB so it's offered again next visit without any upload.

export type BackgroundMode = 'original' | 'blur' | 'photo'
export type BackgroundStatus = 'idle' | 'loading' | 'ready' | 'unavailable'
export type BackgroundPhoto = { id: string; url: string }

const KEY = '8080.background'
const MINE = 'mine'

type Saved = { mode: BackgroundMode; photoId: string | null }

function readSaved(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    const mode = parsed?.mode === 'blur' || parsed?.mode === 'photo' ? parsed.mode : 'original'
    return { mode, photoId: typeof parsed?.photoId === 'string' ? parsed.photoId : null }
  } catch {
    return { mode: 'original', photoId: null }
  }
}

function writeSaved(saved: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(saved)) } catch { /* private mode: not remembered */ }
}

// ─── IndexedDB: one Blob, the user's own photo ────────────────────────────────
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('8080', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

async function idbRun<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction('kv', mode).objectStore('kv'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

const loadMine = () => idbRun<Blob | undefined>('readonly', (s) => s.get('background-photo')).catch(() => undefined)
const saveMine = (blob: Blob) => idbRun('readwrite', (s) => s.put(blob, 'background-photo')).catch(() => undefined)

// ─── store ───────────────────────────────────────────────────────────────────
type BackgroundState = {
  mode: BackgroundMode
  photo: BackgroundPhoto | null
  mine: BackgroundPhoto | null
  status: BackgroundStatus
  message: string | null
  choose: (mode: BackgroundMode, photo?: BackgroundPhoto) => void
  uploadMine: (file: File) => void
  setStatus: (status: BackgroundStatus, message?: string | null) => void
}

const saved = readSaved()
const stock = (id: string | null) => STOCK_IMAGES.find((image) => image.id === id) ?? null

export const useBackground = create<BackgroundState>((set, get) => ({
  // A saved own photo starts as Original until IndexedDB hands it back (below).
  mode: saved.mode === 'photo' && !stock(saved.photoId) ? 'original' : saved.mode,
  photo: stock(saved.photoId),
  mine: null,
  status: 'idle',
  message: null,
  choose: (mode, photo) => {
    const next = mode === 'photo' ? (photo ?? get().photo) : get().photo
    if (mode === 'photo' && !next) return
    set({ mode, photo: next, message: null, status: mode === 'original' ? 'idle' : get().status === 'unavailable' ? 'idle' : get().status })
    writeSaved({ mode, photoId: next?.id ?? null })
  },
  uploadMine: (file) => {
    const previous = get().mine
    const mine = { id: MINE, url: URL.createObjectURL(file) }
    set({ mine })
    get().choose('photo', mine)
    if (previous) URL.revokeObjectURL(previous.url)
    void saveMine(file)
  },
  setStatus: (status, message = null) => set({ status, message }),
}))

// The saved own photo comes back from IndexedDB (and is reselected if it was in use).
void loadMine().then((blob) => {
  if (!blob) {
    if (saved.photoId === MINE) useBackground.getState().choose('original')
    return
  }
  const mine = { id: MINE, url: URL.createObjectURL(blob) }
  useBackground.setState({ mine })
  if (saved.mode === 'photo' && saved.photoId === MINE) useBackground.setState({ mode: 'photo', photo: mine })
})
