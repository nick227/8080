// Plain requests in the channel → which artifact, read by code (doc/13 §14). Bounded
// patterns and keyword lists, no model: "Create a monthly marketing budget for $2,500",
// "Create a spreadsheet of low stock items". The short forms ("sheet", "budget") stay.
import { parseCell } from '@project/shared'
import type { Channel, Goal } from '../../services/marketingBudget'

const CREATE = String.raw`(?:please\s+)?(?:create|make|build|generate|start|give\s+me|i\s+need)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|my\s+|our\s+)?(?:new\s+)?`

/** "Create a spreadsheet of …" / "sheet: …" / "sheet" → the request ('' = none). */
export function spreadsheetRequest(text: string): string | null {
  const t = text.trim()
  const short = t.match(/^sheets?\s*(?::\s*(.*))?$/is)
  if (short) return (short[1] ?? '').trim()
  const long = t.match(new RegExp(`^${CREATE}(?:spreadsheet|sheet)\\b(?:\\s+(?:of|for|with|listing|showing|from|that\\s+shows))?\\s*[:,-]?\\s*(.*)$`, 'is'))
  return long ? (long[1] ?? '').trim().replace(/[.!]$/, '') : null
}

/** "Create a monthly marketing budget for $2,500" / "budget" → what it says (amount may be missing). */
export function budgetRequest(text: string, currency: string): { monthlyMinor: number | null; goal: Goal | null; priorities: Channel[] } | null {
  const t = text.trim()
  const isBudget = /^budget\.?$/i.test(t) || new RegExp(`^${CREATE}(?:monthly\\s+)?(?:marketing\\s+)?budget\\b`, 'i').test(t) || /\bmarketing budget\b/i.test(t)
  if (!isBudget) return null
  return { monthlyMinor: amountIn(t, currency), goal: goalIn(t), priorities: channelsIn(t) }
}

/** The first money-looking amount: "$2,500", "2500 USD", "2.5k", "for 1200 a month". */
export function amountIn(text: string, currency: string): number | null {
  const m = text.match(/(?:[$€£¥]\s?|\b[A-Z]{3}\s)?(\d[\d,]*(?:\.\d+)?)\s?(k\b|thousand\b)?(?:\s?[A-Z]{3}\b)?/i)
  if (!m) return null
  const before = text.slice(0, m.index ?? 0)
  // A bare number counts only as "for N" / "of N" / "N a month"; "$", codes and "k" always do.
  const marked = /[$€£¥]|[A-Z]{3}/.test(m[0]) || !!m[2] || /\b(?:for|of|is|at)\s*$/i.test(before) || /^\s*(?:a|per)\s+month/i.test(text.slice((m.index ?? 0) + m[0].length))
  if (!marked) return null
  const value = Number(m[1]!.replace(/,/g, '')) * (m[2] ? 1000 : 1)
  const parsed = parseCell({ type: 'money', currency }, String(value))
  return parsed.ok && typeof parsed.value === 'number' && parsed.value > 0 ? parsed.value : null
}

const GOAL_WORDS: [Goal, RegExp][] = [
  ['leads', /\b(leads?|inquir|enquir|bookings?|sign-?ups?)/i],
  ['retention', /\b(retention|repeat|keep (?:our |my )?customers|loyal)/i],
  ['launch', /\b(launch|opening|new product)/i],
  ['awareness', /\b(awareness|brand|visibility|get known|reach)\b/i],
  ['sales', /\b(sales|sell more|orders)\b/i],
]
export const goalIn = (text: string): Goal | null => GOAL_WORDS.find(([, re]) => re.test(text))?.[0] ?? null

const CHANNEL_WORDS: [Channel, RegExp][] = [
  ['search', /\b(paid search|google ads|search ads|ppc|sem)\b/i],
  ['social', /\b(social|facebook|instagram|tiktok|linkedin)\b/i],
  ['email', /\b(e-?mail|newsletters?)\b/i],
  ['content', /\b(seo|content|blog)\b/i],
  ['local', /\b(local|print|flyers?|directories|directory)\b/i],
  ['events', /\b(events?|trade shows?|fairs?|meetups?)\b/i],
  ['referral', /\b(referrals?|partners?|partnerships?)\b/i],
]
export const channelsIn = (text: string): Channel[] => CHANNEL_WORDS.filter(([, re]) => re.test(text)).map(([c]) => c).slice(0, 3)

/** The common spreadsheets by their own phrasing — no model needed for these. Narrow on
 *  purpose: a negation ("no follow-up", "without email") or anything else goes to the
 *  planner instead of the nearest preset. */
const PRESET_WORDS: [string, RegExp][] = [
  ['low-stock', /\b(low|out of) stock\b|\brunning low\b/i],
  ['follow-ups-week', /\bfollow[- ]?ups? (this week|due)\b|\bto follow up this week\b/i],
  ['leads-by-stage', /\bleads by stage\b|\bpipeline\b/i],
  ['gone-quiet', /\bgone quiet\b/i],
  ['price-list', /\bprice ?list\b/i],
  ['stock-by-category', /\b(stock|inventory) by category\b/i],
]
export const presetIn = (request: string) => (/\b(no|not|without|never|except|excluding)\b/i.test(request) ? null : PRESET_WORDS.find(([, re]) => re.test(request))?.[0] ?? null)
