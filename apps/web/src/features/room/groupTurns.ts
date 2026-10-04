import type { StreamRow } from './ChatStream'

const WINDOW_MS = 5 * 60 * 1000

export type Turn = {
  id: string
  author: string
  avatarUrl?: string
  postedAt?: string
  rows: StreamRow[]
  unread: boolean
}

function closeEnough(a?: string, b?: string) {
  const left = a ? new Date(a).getTime() : Date.now()
  const right = b ? new Date(b).getTime() : Date.now()
  if (Number.isNaN(left) || Number.isNaN(right)) return false
  return Math.abs(right - left) <= WINDOW_MS
}

export function groupTurns(rows: StreamRow[], unreadId?: string): Turn[] {
  const turns: Turn[] = []
  for (const row of rows) {
    const prev = turns.at(-1)
    const prevRow = prev?.rows.at(-1)
    const sameAuthor = Boolean(prev && prevRow && row.authorId && row.authorId === prevRow.authorId)
    const boundary = row.id === unreadId
    if (prev && sameAuthor && !boundary && closeEnough(prevRow?.postedAt, row.postedAt)) {
      prev.rows.push(row)
      continue
    }
    turns.push({
      id: row.id,
      author: row.author,
      avatarUrl: row.avatarUrl,
      postedAt: row.postedAt,
      rows: [row],
      unread: boundary,
    })
  }
  return turns
}

export function countAfter(rows: StreamRow[], id: string | undefined) {
  if (!id) return 0
  const at = rows.findIndex((row) => row.id === id)
  return at < 0 ? 0 : rows.length - at - 1
}
