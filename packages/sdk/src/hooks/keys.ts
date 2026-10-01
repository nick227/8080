// Query keys shared by all hooks — invalidation only works if these match exactly.
export const keys = {
  me: ['me'] as const,
  rooms: (params?: object) => ['rooms', 'list', params ?? {}] as const,
  roomsAll: ['rooms'] as const,
  myRooms: ['rooms', 'mine'] as const,
  room: (roomId: string) => ['room', roomId] as const,
  items: (roomId: string) => ['items', roomId] as const,
  item: (itemId: string) => ['item', itemId] as const,
}
