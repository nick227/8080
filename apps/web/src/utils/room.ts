// What to call a room. Name is optional, so a blank one falls back to its number.
export function roomTitle(room: { title: string; number: number }): string {
  return room.title.trim() || `Project ${String(room.number).padStart(3, '0')}`
}
