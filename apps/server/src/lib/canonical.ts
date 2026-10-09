// JSON for comparisons: object keys sorted at every level. MySQL's JSON column
// re-orders keys on write (MariaDB keeps them), so stored JSON must never be compared
// to fresh input as a plain JSON.stringify.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]))
  }
  return value
}
