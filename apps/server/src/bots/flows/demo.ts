// Dev-only demo of bot choices (doc/12 Slice A): generic options (one and many),
// locked answers and deterministic advancement, with no product concerns. Started by
// POST /dev/bots/offer; the real flows (welcome, company profile) come in Slice B.
import type { ChoiceFlow, FlowSay } from './registry'

export const DEMO_FLOW = 'demo'

const TONES = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'bold', label: 'Bold' },
  { id: 'technical', label: 'Technical' },
]
const CHANNELS = [
  { id: 'web', label: 'Web' },
  { id: 'email', label: 'Email' },
  { id: 'social', label: 'Social' },
]
const labels = (options: { id: string; label: string }[], ids: string[]) =>
  options.filter((o) => ids.includes(o.id)).map((o) => o.label).join(', ')

export function demoStart(forUserId: string | null = null): FlowSay {
  return {
    text: 'Want to try a quick choice?',
    offer: { step: 'start', options: [{ id: 'yes', label: 'Yes' }, { id: 'not-now', label: 'Not now' }], forUserId },
  }
}

export const demoFlow: ChoiceFlow = {
  advance(_tx, { step, optionIds, userId }) {
    const [first] = optionIds
    switch (step) {
      case 'start':
        return first === 'yes'
          ? [{ text: 'Pick a tone.', offer: { step: 'tone', options: TONES, forUserId: userId } }]
          : [{ text: "No problem — I'm here when you're ready.", offer: { step: 'later', options: [{ id: 'start', label: 'Start' }], forUserId: userId } }]
      case 'later':
        return [demoStart(userId)]
      case 'tone':
        return [{ text: `${labels(TONES, optionIds)} it is. Where will people read it?`, offer: { step: 'channels', mode: 'many', options: CHANNELS, forUserId: userId } }]
      case 'channels':
        return [{ text: `Noted: ${labels(CHANNELS, optionIds)}. That's the end of the demo.` }]
      default:
        return []
    }
  },
}
