export type StockTrack = {
  id: string
  name: string
  url: string
}

export const STOCK_TRACKS: StockTrack[] = [
  { id: 'Swan', name: 'Swan Lake', url: '/songs/Budapest Art Orchestra - Swan Lake Op20 Act 1 No9.mp3' },
  { id: 'ldar', name: 'Walking Around', url: '/songs/Eldar Kedem - Walking Around.mp3' },
  { id: 'Lucas', name: 'ENDER', url: '/songs/Lucas Pluim - ENDER.mp3' },
  { id: 'Roie', name: 'Butterflies', url: '/songs/Roie Shpigler - Butterflies.mp3' },
  { id: 'Shtriker', name: 'Lemonade', url: '/songs/Shtriker Big Band - Lemonade.mp3' },
  { id: 'Yehezkel', name: 'Ballerina', url: '/songs/Yehezkel Raz - Ballerina.mp3' },
  { id: 'drone', name: 'drone', url: '/stock/drone.mp3' },
]

export function stockTrack(id: string): StockTrack {
  const track = STOCK_TRACKS.find(item => item.id === id)
  if (!track) throw new Error('Unknown track')
  return track
}

export type StockImage = {
  id: string
  name: string
  url: string
}

export const STOCK_IMAGES: StockImage[] = [
  { id: 'gradient', name: 'Gradient', url: '/stock/gradient.jpg' },
  { id: 'landscape', name: 'Landscape', url: '/stock/landscape.jpg' },
]

export function stockImage(id: string): StockImage {
  const img = STOCK_IMAGES.find(item => item.id === id)
  if (!img) throw new Error('Unknown image')
  return img
}
