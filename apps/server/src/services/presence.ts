// Deduplicated room presence (doc/08 I4, §4.7). The only consumer of raw SSE
// connect/close; everything else (bot runtime, participant roster) reads this.
//
// Per (room, user): absent → present → leaving → absent.
//   absent  + connect          → present, emit presence.arrived
//   present + connect          → extra tab, no emit
//   present + last disconnect  → leaving (grace timer)
//   leaving + connect          → present silently (refresh / reconnect)
//   leaving + grace expires    → absent, emit presence.left
// Single process; state is lost on restart (everyone re-arrives — the greet
// cooldown, read from the persisted decision log, stops a re-greeting wave).
import { events } from './events'
import { streamHub } from './StreamHub'

export type PresenceState = 'absent' | 'present' | 'leaving'
type Entry = { connections: number; state: Exclude<PresenceState, 'absent'>; timer?: NodeJS.Timeout }

const graceMs = () => {
  const n = Number(process.env.PRESENCE_GRACE_MS)
  return Number.isFinite(n) && n >= 0 ? n : 45_000
}

class RoomPresence {
  private rooms = new Map<string, Map<string, Entry>>()

  /** Register one connection; returns its (idempotent) disconnect. */
  connect(roomId: string, userId: string) {
    let room = this.rooms.get(roomId)
    if (!room) this.rooms.set(roomId, (room = new Map()))
    const entry = room.get(userId)
    if (!entry) {
      room.set(userId, { connections: 1, state: 'present' })
      this.changed(roomId, userId, 'presence.arrived')
    } else {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = undefined
      entry.connections += 1
      entry.state = 'present'
    }
    let closed = false
    return () => {
      if (closed) return
      closed = true
      this.disconnect(roomId, userId)
    }
  }

  state(roomId: string, userId: string): PresenceState {
    return this.rooms.get(roomId)?.get(userId)?.state ?? 'absent'
  }

  /** Present or inside the grace period — a refreshing user still counts as here. */
  isHere(roomId: string, userId: string) {
    return this.state(roomId, userId) !== 'absent'
  }

  here(roomId: string): string[] {
    return [...(this.rooms.get(roomId)?.keys() ?? [])]
  }

  /** Tests: forget everything without emitting. */
  reset() {
    for (const room of this.rooms.values()) for (const entry of room.values()) if (entry.timer) clearTimeout(entry.timer)
    this.rooms.clear()
  }

  private disconnect(roomId: string, userId: string) {
    const room = this.rooms.get(roomId)
    const entry = room?.get(userId)
    if (!room || !entry) return
    entry.connections = Math.max(0, entry.connections - 1)
    if (entry.connections > 0) return
    entry.state = 'leaving'
    entry.timer = setTimeout(() => {
      if (entry.connections > 0) return
      room.delete(userId)
      if (room.size === 0) this.rooms.delete(roomId)
      this.changed(roomId, userId, 'presence.left')
    }, graceMs())
    entry.timer.unref?.()
  }

  private changed(roomId: string, userId: string, name: 'presence.arrived' | 'presence.left') {
    events.emit(name, { roomId, userId })
    streamHub.publishParticipants(roomId)
  }
}

export const roomPresence = new RoomPresence()
