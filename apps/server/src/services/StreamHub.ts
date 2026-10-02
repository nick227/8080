// In-process fan-out of room events to SSE connections.
// ## Phase 2: Redis pub/sub so multiple server instances share events.
// ## Phase 2: drop a member's open streams when they leave a private room.

export type StreamEvent = {
  type: 'item.created' | 'item.updated'
  actorId: string
  itemId: string
  itemNumber: number
}

type Client = { userId: string; write: (frame: string) => boolean; close: () => void }

class StreamHub {
  private rooms = new Map<string, Set<Client>>()

  subscribe(roomId: string, client: Client) {
    let set = this.rooms.get(roomId)
    if (!set) this.rooms.set(roomId, (set = new Set()))
    set.add(client)
    return () => {
      set!.delete(client)
      if (set!.size === 0) this.rooms.delete(roomId)
    }
  }

  publish(roomId: string, event: StreamEvent) {
    const clients = this.rooms.get(roomId)
    if (!clients) return
    const id = event.type === 'item.created' ? `id: ${event.itemNumber}\n` : ''
    const frame = `${id}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    for (const client of clients) {
      // Disconnect clients immediately if write buffer is full (backpressure),
      // to avoid memory leaks or delaying other users. Client will reconnect.
      const ok = client.write(frame)
      if (!ok) {
        setImmediate(() => {
          try {
            client.close()
          } catch (e) {}
        })
      }
    }
  }

  connectionCount(roomId?: string) {
    if (roomId) return this.rooms.get(roomId)?.size ?? 0
    let n = 0
    for (const set of this.rooms.values()) n += set.size
    return n
  }
}

export const streamHub = new StreamHub()
