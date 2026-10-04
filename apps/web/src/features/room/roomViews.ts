import { youTubeThumbnailUrl } from '@project/shared'
import type { Item, Media } from '../../api/types'
import type { RoomPerson } from './PeopleStrip'

export type RoomView = 'stage' | 'you' | 'gallery' | 'speaker' | 'log'

export const ROOM_VIEWS: { id: RoomView; label: string }[] = [
  { id: 'stage', label: 'Stage' },
  { id: 'you', label: 'You' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'speaker', label: 'Speaker' },
  { id: 'log', label: 'Log' },
]

const KEY = 'vc-room-view'

export function loadRoomView(): RoomView {
  try {
    const stored = localStorage.getItem(KEY)
    return ROOM_VIEWS.some((view) => view.id === stored) ? stored as RoomView : 'stage'
  } catch {
    return 'stage'
  }
}

export function saveRoomView(view: RoomView) {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    // The choice still applies for this visit.
  }
}

export type Seat = {
  id: string
  name: string
  avatarUrl?: string
  self: boolean
  guest: boolean
  activity: RoomPerson['activity']
  still?: string
  itemId?: string
}

function stillOf(media: Media) {
  if (media.type === 'image') return media.url
  if (media.poster) return media.poster
  if (media.externalId) return youTubeThumbnailUrl(media.externalId)
  return undefined
}

export function seatsFrom(people: RoomPerson[], items: Item[], meId: string | undefined, meGuest: boolean): Seat[] {
  const stream = new Map<string, { still?: string; itemId: string }>()
  for (const item of items) {
    const media = item.media?.find((entry) => entry.type === 'image' || entry.type === 'video')
    const still = media ? stillOf(media) : undefined
    const prev = stream.get(item.author.id)
    if (still || !prev) stream.set(item.author.id, { still: still ?? prev?.still, itemId: still ? item.id : (prev?.itemId ?? item.id) })
  }
  const seats = people.map((person) => {
    const latest = stream.get(person.id)
    const self = person.id === meId
    return {
      id: person.id,
      name: self ? 'You' : person.name,
      avatarUrl: person.avatarUrl,
      self,
      guest: self && meGuest,
      activity: person.activity,
      still: latest?.still,
      itemId: latest?.itemId,
    }
  })
  seats.sort((a, b) => Number(b.self) - Number(a.self))
  return seats
}

export function latestBy(items: Item[], authorId: string | undefined) {
  if (!authorId) return undefined
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].author.id === authorId) return items[index]
  }
  return undefined
}
