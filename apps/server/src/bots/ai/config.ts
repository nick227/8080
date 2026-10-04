// AI is opt-in and bounded (doc/08 Phase 2). With AI_ROUTER unset/off, or no key or
// model, nothing is ever called and the deterministic system runs the product.
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function routerConfig() {
  const mode = process.env.AI_ROUTER === 'shadow' ? 'shadow' : 'off'
  return {
    mode: mode as 'shadow' | 'off',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_ROUTER_MODEL ?? '',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    timeoutMs: num(process.env.AI_ROUTER_TIMEOUT_MS, 2500),
    /** Unmentioned human messages routed for comparison (mentioned ones always are). */
    sample: Math.min(num(process.env.AI_ROUTER_SAMPLE, 0.25), 1),
    perRoomPer10Min: num(process.env.AI_ROUTER_ROOM_MAX, 30),
    perDay: num(process.env.AI_ROUTER_DAILY_MAX, 2000),
  }
}
