// Lobby card meta: lengths, days and "how long ago", in the mono uppercase voice.

/** 08:41 / 1:02:09 — total media time. */
export function formatLength(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** OCT 1 (this year) / OCT 1 2025. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  return d.getFullYear() === now.getFullYear() ? `${month} ${d.getDate()}` : `${month} ${d.getDate()} ${d.getFullYear()}`
}

/** JUST NOW / 5M AGO / 2H AGO / 3D AGO, then the day. */
export function formatAgo(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'JUST NOW'
  if (minutes < 60) return `${minutes}M AGO`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}H AGO`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}D AGO`
  return formatDay(iso, now)
}
