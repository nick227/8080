// OpenAI is OBSERVATIONAL ONLY (doc/08 §4.9, binding): it may classify and
// recommend; it cannot create user-visible content or mutate workspace state.
// There is no live mode — AI_ROUTER is `shadow` or off, nothing else.
//
// Off unless AI_ROUTER=shadow + OPENAI_API_KEY + OPENAI_ROUTER_MODEL, and never in
// tests or with BOTS=off. With it off the product is fully functional.
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function routerConfig() {
  const enabled = process.env.AI_ROUTER === 'shadow' && process.env.NODE_ENV !== 'test' && process.env.BOTS !== 'off'
  return {
    mode: (enabled ? 'shadow' : 'off') as 'shadow' | 'off',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_ROUTER_MODEL ?? '',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    // Shadow blocks nothing; a cold first call (~5s) can still time out — logged.
    timeoutMs: num(process.env.AI_ROUTER_TIMEOUT_MS, 5000),
    /** Share of unmentioned human messages routed. Explicit mentions: never (hard rule). */
    sample: Math.min(num(process.env.AI_ROUTER_SAMPLE, 1), 1),
    perRoomPer10Min: num(process.env.AI_ROUTER_ROOM_MAX, 30),
    perDay: num(process.env.AI_ROUTER_DAILY_MAX, 2000),
    /** Hard daily spend cap (estimated). */
    dailyUsd: num(process.env.AI_ROUTER_DAILY_USD, 1),
    // Price per million tokens for the cost estimate (defaults: gpt-4.1-mini).
    priceInPerM: num(process.env.AI_PRICE_INPUT_PER_M, 0.4),
    priceOutPerM: num(process.env.AI_PRICE_OUTPUT_PER_M, 1.6),
  }
}
