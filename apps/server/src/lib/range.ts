import type { ByteRange } from '../providers/storage'

// Single-range `Range: bytes=…` (RFC 9110 §14) resolved against the object's size.
//   null           → no usable range: serve the whole object (also for multi-range/malformed)
//   'unsatisfiable' → 416
// Media elements (Safari especially) need range support to seek and to play at all.
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null

  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(m[2])
    if (suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(m[1])
  if (m[2] !== '' && Number(m[2]) < start) return null // invalid range: ignore the header
  if (start >= size) return 'unsatisfiable'
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  return { start, end }
}
