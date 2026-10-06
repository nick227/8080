// Posts a flow's lines as the bot that runs it, on the workflow allowance (doc/12).
// A line the rails refuse (allowance spent, bot unseated, BOTS=off) is logged; the
// answer that caused it has already committed and stands.
import { ItemService } from '../../services/ItemService'
import { botsEnabled } from '../limits'
import type { FlowSay } from './registry'

const items = new ItemService()

export async function postSays(botUserId: string, roomId: string, chat: boolean, flow: string, says: FlowSay[]) {
  const posted: string[] = []
  if (!botsEnabled()) return posted
  for (const say of says) {
    try {
      const actions = say.offer ? { ...say.offer, flow } : undefined
      const item = await items.send(botUserId, roomId, { text: say.text, chat }, { actions, workflow: flow, links: say.links })
      posted.push(item.id)
      await say.onPosted?.(item.id).catch((error) => console.error(`[flow] ${flow}: after-post hook failed`, error))
    } catch (error) {
      console.error(`[flow] ${flow}: line not posted`, error)
    }
  }
  return posted
}
