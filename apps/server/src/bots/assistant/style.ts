// The house voice for anything the assistant writes (doc/12 §7.5). One guide, used by
// every drafting prompt, plus a deterministic check that flags what the guide forbids
// so drafts can be reviewed from the AssistantCall log instead of by impression.

export const WRITING_RULES = [
  'Writing rules — follow all of them:',
  '1. Plain, readable English. Mostly short, simple sentences: subject, verb, object. One idea per sentence. Use the same simple structure throughout.',
  '2. Find the real value in the facts and say it concretely: what the company does, for whom, how, and what difference that makes to them. A specific detail beats an adjective.',
  '3. Every sentence must tell the reader something useful. No filler, no warm-up, no restating. Do not end on a sentence that sums up, praises or says what makes the company stand out — stop when the facts are said.',
  '4. No marketing language or clichés. Never use words like passionate, innovative, cutting-edge, world-class, seamless, solutions, leverage, empower, elevate, unlock, journey, dedicated to, committed to, one-stop, best-in-class, next level.',
  '5. Do not over-promise. No guarantees, superlatives or claimed results. Never add clients, numbers, years, awards, team size or outcomes that are not in the facts, and do not present an example as past work unless the person said it was. If something is unknown, leave it out.',
  '6. No jokes, puns, wordplay, exclamation marks, emojis or cute phrasing unless the brief asks for them.',
  '7. No jargon or buzzwords. If a technical term is needed, it is one the business itself uses; say it plainly.',
  '8. Correct grammar and punctuation. Refer to the company by name or as "it", consistently, in the third person ("Midnight Creative builds… It also…") — never "we", and never switch to "they".',
  '9. The voice changes tone, never these rules: professional = neutral and precise; friendly = warm and direct, everyday words; bold = confident, active, short sentences, still no hype; technical = precise about the methods and tools named in the facts. Never describe the tone itself (don\'t call the company bold, friendly or professional).',
  '10. Length is a ceiling, not a target: short = one paragraph of 2–4 sentences, medium = two paragraphs, detailed = three or four. If the facts don\'t support the length, write less.',
].join('\n')

// What rule 4–6 forbid, as patterns. Flags are logged, not enforced: a flagged draft
// is still usable, and the log shows whether the prompt holds up.
const CLICHES = [
  'passionate', 'innovative', 'innovation', 'cutting-edge', 'cutting edge', 'world-class', 'world class', 'seamless', 'seamlessly',
  'solutions', 'leverage', 'leveraging', 'empower', 'empowering', 'elevate', 'unlock', 'journey', 'dedicated to', 'committed to',
  'one-stop', 'best-in-class', 'next level', 'state-of-the-art', 'synergy', 'game-changer', 'game changer', 'tailored', 'robust',
  'streamline', 'streamlining', 'thrive', 'harness', 'holistic', 'unparalleled', 'second to none', 'look no further',
  'expertise', 'enhance', 'optimize', 'specializing in', 'specializes in', 'trusted partner', 'human touch', 'driven',
]
const PROMISES = ['guarantee', 'guarantees', 'guaranteed', 'ensure', 'ensures', 'ensuring', 'the best', 'always deliver', 'never fail', 'unmatched', '100%', 'leading', 'premier', 'number one', '#1']

export type StyleFlags = { cliches: string[]; promises: string[]; exclamations: number; firstPerson: number; longSentences: number; toneNamed: string[] }

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
const find = (text: string, words: string[]) =>
  words.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')}([^a-z]|$)`, 'i').test(text))

/** What a draft does that the guide forbids. Empty arrays and zeros = clean.
 *  `source` = the facts and answers it was written from: a voice word the person used
 *  themselves ("two technical founders") is a fact, not the tone being named. */
export function styleFlags(paragraphs: string[], voice?: string | null, source = ''): StyleFlags {
  const text = paragraphs.join('\n')
  return {
    cliches: find(text, CLICHES),
    promises: find(text, PROMISES),
    exclamations: (text.match(/!/g) ?? []).length,
    firstPerson: (text.match(/\b(we|we're|our|us)\b/gi) ?? []).length,
    // Rule 1: over ~30 words is rarely one idea.
    longSentences: sentencesOf(text).filter((s) => s.split(/\s+/).length > 30).length,
    // Rule 9: the tone is shown, not named ("a bold studio", "a professional approach").
    toneNamed: voice && !find(source, [voice]).length ? find(text, [voice]) : [],
  }
}

/** The flags as instructions for a revision pass. */
export function problemsOf(f: StyleFlags): string[] {
  const out: string[] = []
  if (f.cliches.length) out.push(`Remove these marketing words and say plainly what is actually done instead: ${f.cliches.join(', ')}.`)
  if (f.promises.length) out.push(`Remove these promises or claims: ${f.promises.join(', ')}. State the fact without promising a result.`)
  if (f.exclamations) out.push('Remove the exclamation marks.')
  if (f.firstPerson) out.push('Write in the third person, using the company name — not we, our or us.')
  if (f.longSentences) out.push(`Split the ${f.longSentences} sentence(s) longer than 30 words into short sentences.`)
  if (f.toneNamed.length) out.push(`Do not call the company ${f.toneNamed.join(' or ')}; show the tone instead of naming it.`)
  return out
}
/** Fewer is better; used to keep a revision only if it improved. */
export const flagCount = (f: StyleFlags) => f.cliches.length + f.promises.length + f.exclamations + f.firstPerson + f.longSentences + f.toneNamed.length

export const isClean = (f: StyleFlags) => !f.cliches.length && !f.promises.length && !f.exclamations && !f.firstPerson && !f.longSentences && !f.toneNamed.length
