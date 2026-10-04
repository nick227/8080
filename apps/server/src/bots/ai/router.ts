// The AI intent router (doc/08 Phase 2 slice 1). One small structured call:
// message + compact room context + seated bots → { agent, intent, confidence,
// shouldRespond }. It generates no reply. Providers are swappable (tests use a fake).
import { routerConfig } from './config'

export const ROUTER_INTENTS = ['greeting', 'question', 'help', 'task', 'praise', 'complaint', 'media-request', 'smalltalk', 'other'] as const

export type RouterInput = {
  room: { title: string }
  message: { author: string; text: string; surface: 'chat' | 'stage' }
  recent: { author: string; text: string }[] // oldest first, truncated
  bots: { handle: string; name: string; persona: string }[]
}
export type RouterOutput = { agent: string | null; intent: string; confidence: number; shouldRespond: boolean }
export interface RouterProvider {
  readonly name: string
  readonly model: string | null
  route(input: RouterInput, signal: AbortSignal): Promise<RouterOutput>
}

const SYSTEM = [
  'You route messages in a group voice/text conversation to at most one bot participant.',
  'Pick the bot whose persona best fits, or null if no bot should answer.',
  'shouldRespond is true only if a bot answering would be welcome: the bot is addressed by name,',
  'or a question/request is clearly aimed at a bot. People talking to each other → false.',
  'Intents: task = asks for something to be produced or done (write, draft, give me, make);',
  'media-request = asks to play/show/share audio, video or images; help = how to use something or fix a problem.',
  'Never invent bots. Reply with JSON only.',
].join(' ')

export class OpenAIRouter implements RouterProvider {
  readonly name = 'openai'
  constructor(private readonly cfg = routerConfig()) {}
  get model() { return this.cfg.model }

  async route(input: RouterInput, signal: AbortSignal): Promise<RouterOutput> {
    const handles = input.bots.map((b) => b.handle)
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(input) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'route',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['agent', 'intent', 'confidence', 'shouldRespond'],
              properties: {
                agent: { type: ['string', 'null'], enum: [...handles, null] },
                intent: { type: 'string', enum: [...ROUTER_INTENTS] },
                confidence: { type: 'number' },
                shouldRespond: { type: 'boolean' },
              },
            },
          },
        },
      }),
    })
    if (!res.ok) throw new Error(`openai ${res.status}`)
    const body: any = await res.json()
    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('openai: no content')
    return validate(JSON.parse(content), handles)
  }
}

/** Never trust the model's shape: unknown bots → null, intent/confidence clamped. */
export function validate(raw: any, handles: string[]): RouterOutput {
  const agent = typeof raw?.agent === 'string' && handles.includes(raw.agent) ? raw.agent : null
  const intent = ROUTER_INTENTS.includes(raw?.intent) ? raw.intent : 'other'
  const c = Number(raw?.confidence)
  return { agent, intent, confidence: Number.isFinite(c) ? Math.min(Math.max(c, 0), 1) : 0, shouldRespond: raw?.shouldRespond === true && agent !== null }
}

let override: RouterProvider | null | undefined
/** Tests: swap the provider (null = none). */
export function setRouterProvider(provider: RouterProvider | null | undefined) {
  override = provider
}

/** The active provider, or null when AI routing is off / unconfigured. */
export function routerProvider(): RouterProvider | null {
  if (override !== undefined) return override
  const cfg = routerConfig()
  if (cfg.mode === 'off' || !cfg.apiKey || !cfg.model) return null
  return new OpenAIRouter(cfg)
}
