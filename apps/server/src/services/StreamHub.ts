// In-process fan-out of room events to SSE connections.
// ## Phase 2: Redis pub/sub so multiple server instances share events.
// ## Phase 2: drop a member's open streams when they leave a private room.

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

  private write(roomId: string, frame: string) {
    const clients = this.rooms.get(roomId)
    if (!clients) return
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

  // Roster changed (presence or seating): clients refetch listRoomParticipants.
  publishParticipants(roomId: string) {
    this.write(roomId, `event: participants.updated\ndata: ${JSON.stringify({ type: 'participants.updated', roomId })}\n\n`)
  }

  connectionCount(roomId?: string) {
    if (roomId) return this.rooms.get(roomId)?.size ?? 0
    let n = 0
    for (const set of this.rooms.values()) n += set.size
    return n
  }
}

export const streamHub = new StreamHub()
