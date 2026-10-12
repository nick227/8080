import { db } from '@project/db'

const streams = new Map<string, Set<() => void>>()
let timer: ReturnType<typeof setInterval> | undefined
let checking = false

// Immediate same-process revocation plus a DB check for suspension on another
// instance. Stream handlers still enforce their resource-specific permissions.
export function disconnectAccountStreams(userId: string) {
  for (const close of [...(streams.get(userId) ?? [])]) close()
}
export function watchAccountStream(userId: string, raw: { destroy: () => void; on: (event: 'close', listener: () => void) => unknown }) {
  let clients = streams.get(userId)
  if (!clients) streams.set(userId, clients = new Set())
  const close = () => raw.destroy()
  clients.add(close)
  raw.on('close', () => {
    clients!.delete(close)
    if (!clients!.size) streams.delete(userId)
    if (!streams.size && timer) { clearInterval(timer); timer = undefined }
  })
  if (!timer) {
    timer = setInterval(async () => {
      if (checking) return
      checking = true
      const ids = [...streams.keys()]
      try {
        const active = await db.user.findMany({ where: { id: { in: ids }, suspendedAt: null, deletedAt: null }, select: { id: true } })
        const allowed = new Set(active.map(user => user.id))
        for (const id of ids) if (!allowed.has(id)) disconnectAccountStreams(id)
      } catch {
        // Fail closed on a failed reauthorization; clients may reconnect later.
        for (const id of ids) disconnectAccountStreams(id)
      } finally { checking = false }
    }, 2000)
    timer.unref()
  }
}
