export type StockTrack = {
  id: string
  name: string
  url: string
}

export const STOCK_TRACKS: StockTrack[] = [
  { id: 'pulse', name: 'Pulse', url: '/stock/pulse.mp3' },
  { id: 'drone', name: 'Drone', url: '/stock/drone.mp3' },
  { id: 'chirp', name: 'Chirp', url: '/stock/chirp.mp3' },
  { id: 'ticks', name: 'Ticks', url: '/stock/ticks.mp3' },
  { id: 'fifth', name: 'Fifth', url: '/stock/fifth.mp3' },
]

export function stockTrack(id: string): StockTrack {
  const track = STOCK_TRACKS.find(item => item.id === id)
  if (!track) throw new Error('Unknown track')
  return track
}
