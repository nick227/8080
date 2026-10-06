import assert from 'node:assert/strict'
import { AsyncTtlCache } from '../apps/server/src/lib/AsyncTtlCache'
import { useData } from '../apps/web/src/state/data'
import { branchOf, replyCount } from '../apps/web/src/utils/graph'
import type { Item } from '../apps/web/src/api/types'

async function cacheChecks() {
  let now = 0
  let reads = 0
  const cache = new AsyncTtlCache<string, string>(2, 5, () => now)
  const read = (key: string) => cache.get(key, async () => { reads++; return key })
  const first = read('a')
  assert.equal(read('a'), first)
  await first
  await read('b')
  await read('a') // a becomes most recently used
  await read('c') // b is evicted
  assert.equal(reads, 3)
  await read('b')
  assert.equal(reads, 4)
  now = 5
  await read('b') // TTL boundary is expired
  assert.equal(reads, 5)

  let resolveOld!: (value: string) => void
  const old = cache.get('race', () => new Promise<string>(resolve => { resolveOld = resolve }))
  await Promise.resolve()
  cache.delete('race')
  assert.equal(await cache.get('race', async () => 'fresh'), 'fresh')
  resolveOld('stale')
  await old
  assert.equal(await cache.get('race', async () => 'wrong'), 'fresh')

  await assert.rejects(cache.get('failure', async () => { throw new Error('failed') }))
  assert.equal(await cache.get('failure', async () => 'retried'), 'retried')

  // Pending entries count toward the same capacity; their completion cannot
  // displace a newer entry or repopulate the cache after eviction.
  const bounded = new AsyncTtlCache<string, string>(1, 5, () => now)
  let finish!: (value: string) => void
  const pending = bounded.get('old', () => new Promise<string>(resolve => { finish = resolve }))
  await Promise.resolve()
  await bounded.get('new', async () => 'new')
  finish('old')
  await pending
  assert.equal(await bounded.get('new', async () => 'wrong'), 'new')
}

function graphChecks() {
  const item = (id: string, parentId?: string, day = 1) => ({ id, parentId, createdAt: `2026-01-${String(day).padStart(2, '0')}` }) as Item
  const root = item('root'), a = item('a', 'root', 3), b = item('b', 'root', 2)
  const store = () => useData.getState()
  store().replaceItems([root, a])
  const before = store()
  store().upsertItem(b)
  assert.deepEqual(store().orderedIds, ['root', 'b', 'a'])
  assert.deepEqual(before.orderedIds, ['root', 'a'])
  assert.deepEqual(before.childrenById.root, ['a'])
  const beforeDelete = store()
  store().removeItem('a')
  assert.deepEqual(store().childrenById.root, ['b'])
  assert.deepEqual(beforeDelete.childrenById.root, ['a', 'b'])
  assert.equal(replyCount(store().itemsById, store().childrenById, 'root'), 1)
  store().upsertItem({ ...b, parentId: 'absent' })
  assert.equal(store().childrenById.root, undefined)
  assert.deepEqual(store().childrenById.absent, ['b'])
  store().addItem(item('absent'))
  assert.equal(replyCount(store().itemsById, store().childrenById, 'absent'), 1)
  store().removeItem('absent')
  store().addItem(item('absent'))
  assert.equal(replyCount(store().itemsById, store().childrenById, 'absent'), 1)
  const ids = { root, a, b }
  const children = { root: ['missing', 'b', 'a', 'a'], a: ['root'], b: ['b'] }
  assert.equal(replyCount(ids, children, 'root'), 2)
  assert.equal(branchOf(ids, children, 'root').length, 3)
  assert.equal(replyCount(ids, children, 'missing'), 0)
  const deep: Record<string, Item> = {}, edges: Record<string, string[]> = {}
  for (let i = 0; i < 20_000; i++) {
    deep[i] = item(String(i))
    if (i) edges[i - 1] = [String(i)]
  }
  assert.equal(replyCount(deep, edges, '0'), 19_999)
  store().replaceItems([])
}

async function main() {
  await cacheChecks()
  graphChecks()
  console.log('Retention checks passed: cache TTL/LRU/sharing/failure/invalidation/eviction races; immutable state deletion/reparenting; cyclic, missing and deep graphs')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
