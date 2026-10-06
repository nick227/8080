// The chatbot assistant (doc/12 §7, policy §2): AI may extract facts and draft
// documents for registered workflows. The model returns data; workflow code decides
// what happens. Off unless AI_ASSISTANT=on + OPENAI_API_KEY + a model, and never in
// tests or with BOTS=off — with it off every workflow runs its deterministic path.
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function assistantConfig() {
  const enabled = process.env.AI_ASSISTANT === 'on' && process.env.NODE_ENV !== 'test' && process.env.BOTS !== 'off'
  return {
    enabled,
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_ASSISTANT_MODEL ?? process.env.OPENAI_ROUTER_MODEL ?? '',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    // A person is waiting on these; past this the workflow falls back.
    extractTimeoutMs: num(process.env.AI_ASSISTANT_EXTRACT_TIMEOUT_MS, 15_000),
    generateTimeoutMs: num(process.env.AI_ASSISTANT_GENERATE_TIMEOUT_MS, 30_000),
    perWorkspacePerDay: num(process.env.AI_ASSISTANT_WORKSPACE_DAILY_MAX, 20),
    perDay: num(process.env.AI_ASSISTANT_DAILY_MAX, 500),
    /** Hard daily spend cap across all workspaces (estimated). */
    dailyUsd: num(process.env.AI_ASSISTANT_DAILY_USD, 2),
    priceInPerM: num(process.env.AI_PRICE_INPUT_PER_M, 0.4),
    priceOutPerM: num(process.env.AI_PRICE_OUTPUT_PER_M, 1.6),
  }
}
export type AssistantConfig = ReturnType<typeof assistantConfig>
