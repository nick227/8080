type Entry<V> = { promise: Promise<V>; expiresAt: number }

/** Bounded access-order cache. Pending reads share the same entry as resolved values. */
export class AsyncTtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>()

  constructor(private readonly capacity: number, private readonly ttlMs: number, private readonly now = Date.now) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Cache requires a positive capacity and TTL')
    }
  }

  get(key: K, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.now()) {
      this.entries.delete(key)
      this.entries.set(key, hit)
      return hit.promise
    }
    this.entries.delete(key)
    const entry: Entry<V> = { promise: Promise.resolve().then(load), expiresAt: Infinity }
    entry.promise = entry.promise.then(value => {
      // Invalidated or evicted reads must never restore their old value.
      if (this.entries.get(key) === entry) entry.expiresAt = this.now() + this.ttlMs
      return value
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    })
    this.entries.set(key, entry)
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!)
    return entry.promise
  }

  delete(key: K): void {
    this.entries.delete(key)
  }
}
