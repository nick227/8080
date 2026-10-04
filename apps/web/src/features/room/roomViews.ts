import type { RoomPerson } from './PeopleStrip'

export type RoomView = 'room' | 'you'

export const ROOM_VIEWS: RoomView[] = ['room', 'you']

const KEY = 'vc-room-view'

export function loadRoomView(): RoomView {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'you' ? 'you' : 'room'
  } catch {
    return 'room'
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

export type Seat = {
  id: string
  name: string
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
      avatarUrl: person.avatarUrl,
      self,
      guest: self && meGuest,
      activity: person.activity,
    }
  })
  seats.sort((a, b) => Number(b.self) - Number(a.self))
  return seats
}
