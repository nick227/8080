// Durations in packs: 500ms · 2s · 3m · 12h (or a number of ms).
export function parseDurationValue(value: unknown): number {
  if (typeof value === 'number') return value
  const m = typeof value === 'string' ? /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim()) : null
  if (!m) throw new Error(`bad duration ${JSON.stringify(value)} (use 500ms, 2s, 3m, 12h)`)
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] as 'ms']
}
