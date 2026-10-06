// Room-wide bot rails shared by the runtime (cheap pre-check) and the write
// transaction (authoritative backstop) — doc/08 §4.1, §4.5.
import type { Prisma } from '@project/db'
const num = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export const BOT_LIMITS = {
  /** Max bot items per room (all bots together) inside the window. */
  roomCap: num(process.env.BOT_ROOM_CAP, 6),
  roomCapWindowMs: num(process.env.BOT_ROOM_CAP_WINDOW_SEC, 600) * 1000,
  /** Max consecutive bot items without a human item between them. */
  maxConsecutive: num(process.env.BOT_MAX_CONSECUTIVE, 3),
  /** Registered workflows (doc/12) post on their own budget, never the ones above:
   *  at most this many workflow posts per room inside the same window… */
  workflowRoomCap: num(process.env.BOT_WORKFLOW_ROOM_CAP, 30),
  /** …and at most this many posts in answer to one human choice. */
  workflowPostsPerAnswer: num(process.env.BOT_WORKFLOW_POSTS_PER_ANSWER, 3),
}

/** Items the ordinary bot rails count: everything except workflow posts. Workflow
 *  posts neither use the ordinary budget nor count as a human turn. */
export const ordinaryItemWhere = { message: { workflow: null } } satisfies Prisma.ItemWhereInput

/** BOTS=off is the kill switch: nothing from any bot is posted. */
export const botsEnabled = () => process.env.BOTS !== 'off'
