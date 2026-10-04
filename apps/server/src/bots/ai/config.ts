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
    // Two budgets on purpose: shadow calls block nothing and can wait; a live call
    // sits in front of a reply and must fall back to deterministic routing fast.
    // Never reuse the shadow budget for the live path.
    shadowTimeoutMs: num(process.env.AI_ROUTER_SHADOW_TIMEOUT_MS, 5000),
    liveTimeoutMs: num(process.env.AI_ROUTER_LIVE_TIMEOUT_MS, 2000),
    /** Unmentioned human messages routed (the cases the router exists for). */
    sample: Math.min(num(process.env.AI_ROUTER_SAMPLE, 1), 1),
    /** Explicit mentions routed only as a control — deterministic routing owns them. */
    mentionSample: Math.min(num(process.env.AI_ROUTER_MENTION_SAMPLE, 0.1), 1),
    perRoomPer10Min: num(process.env.AI_ROUTER_ROOM_MAX, 30),
    perDay: num(process.env.AI_ROUTER_DAILY_MAX, 2000),
  }
}
