// In-process domain events (doc/08 §2.2). Services emit after their write commits;
// the bot runtime (and anything else server-side) listens. Single instance, like
// StreamHub — ## Phase 2: Redis when the server scales out.
//
// Delivery is asynchronous (next tick) and listener errors are contained, so a
// listener can never fail or slow the request that produced the event.

export type DomainEvents = {
  'item.created': {
    roomId: string
    itemId: string
    itemNumber: number
    actorId: string
    actorKind: 'human' | 'bot'
    chat: boolean
    parentId: string | null
    text: string | null
    roomOwnerId: string
    /** This item is the room's first live human-authored item (doc/08 R9b). */
    firstHumanItem: boolean
  }
  'member.joined': { roomId: string; userId: string }
  'presence.arrived': { roomId: string; userId: string }
  'presence.left': { roomId: string; userId: string }
  'seating.changed': { roomId: string; botId: string }
}

type Name = keyof DomainEvents
type Listener<K extends Name> = (event: DomainEvents[K]) => void | Promise<void>

class DomainEventBus {
  private listeners = new Map<Name, Set<Listener<any>>>()

  on<K extends Name>(name: K, listener: Listener<K>) {
    let set = this.listeners.get(name)
    if (!set) this.listeners.set(name, (set = new Set()))
    set.add(listener)
    return () => { set!.delete(listener) }
  }

  emit<K extends Name>(name: K, event: DomainEvents[K]) {
    const set = this.listeners.get(name)
    if (!set?.size) return
    for (const listener of [...set]) {
      setImmediate(() => {
        Promise.resolve()
          .then(() => listener(event))
          .catch((error) => console.error(`[events] ${name} listener failed`, error))
      })
    }
  }
}

export const events = new DomainEventBus()
