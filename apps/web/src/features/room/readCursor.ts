type Cursors = Record<string, number>

function key(userId: string) {
  return `vc-read:${userId}`
}

function load(userId: string): Cursors {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Cursors
  } catch {
    return {}
  }
}

export function readNumber(userId: string | undefined, roomId: string): number | null {
  if (!userId) return null
  const number = load(userId)[roomId]
  return typeof number === 'number' ? number : null
}

export function markRead(userId: string | undefined, roomId: string, number: number) {
  if (!userId) return
  const all = load(userId)
  if ((all[roomId] ?? 0) >= number) return
  all[roomId] = number
  localStorage.setItem(key(userId), JSON.stringify(all))
}
