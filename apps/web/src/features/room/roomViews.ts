import type { RoomPerson } from './PeopleStrip'

export type RoomView = 'screen' | 'grid'

export const ROOM_VIEWS: RoomView[] = ['grid', 'screen']

export const VIEW_LABEL: Record<RoomView, string> = {
  screen: 'Full screen',
  grid: 'Grid',
}

const KEY = 'vc-room-view'

export function loadRoomView(): RoomView {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'screen' ? 'screen' : 'grid'
  } catch {
    return 'grid'
  }
}

export function saveRoomView(view: RoomView) {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    // The choice still applies for this visit.
  }
}

export function nextView(view: RoomView): RoomView {
  const index = ROOM_VIEWS.indexOf(view)
  return ROOM_VIEWS[(index + 1) % ROOM_VIEWS.length]
}

export type TileDensity = 'few' | 'some' | 'many' | 'crowd'

export function tileDensity(count: number): TileDensity {
  if (count <= 2) return 'few'
  if (count <= 6) return 'some'
  if (count <= 12) return 'many'
  return 'crowd'
}

export type Seat = {
  id: string
  name: string
  tag?: string
  avatarUrl?: string
  self: boolean
  guest: boolean
  activity: RoomPerson['activity']
}

export function seatsFrom(people: RoomPerson[], meId: string | undefined, meGuest: boolean): Seat[] {
  const seats = people.map((person) => {
    const self = person.id === meId
    return {
      id: person.id,
      name: person.name,
      tag: person.tag,
      avatarUrl: person.avatarUrl,
      self,
      guest: self && meGuest,
      activity: person.activity,
    }
  })
  seats.sort((a, b) => Number(b.self) - Number(a.self))
  return seats
}
