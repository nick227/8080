// Room-wide bot rails shared by the runtime (cheap pre-check) and the write
// transaction (authoritative backstop) — doc/08 §4.1, §4.5.
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
}

/** BOTS=off is the kill switch: nothing from any bot is posted. */
export const botsEnabled = () => process.env.BOTS !== 'off'
