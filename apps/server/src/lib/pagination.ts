type CursorPayload = {
  createdAt: string
  id: string
}

export function encodeCursor(payload: CursorPayload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null

  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw { statusCode: 400, message: 'Invalid cursor' }
  }
}

export function normalizeLimit(limit?: number, max = 100, fallback = 20) {
  return Math.min(Math.max(Number(limit ?? fallback), 1), max)
}

// Generic keyset cursor for non-timestamp sort keys (e.g. per-room item number).
export function encodeKeyCursor<T extends object>(payload: T) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeKeyCursor<T extends object>(cursor?: string): T | null {
  if (!cursor) return null
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw { statusCode: 400, message: 'Invalid cursor' }
  }
}

export function page<T>(rows: T[], limit: number, toCursor: (last: T) => string) {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  return { data, meta: { hasMore, nextCursor: hasMore && last ? toCursor(last) : null } }
}
