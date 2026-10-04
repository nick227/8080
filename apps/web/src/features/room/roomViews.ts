import type { RoomPerson } from './PeopleStrip'

export type RoomView = 'room' | 'you' | 'log'

export const ROOM_VIEWS: { id: RoomView; label: string }[] = [
  { id: 'room', label: 'Room' },
  { id: 'you', label: 'You' },
  { id: 'log', label: 'Log' },
]

const KEY = 'vc-room-view'

const known: Record<string, RoomView> = {
  room: 'room',
  you: 'you',
  log: 'log',
  stage: 'room',
  gallery: 'room',
  speaker: 'room',
}

export function loadRoomView(): RoomView {
  try {
    const stored = localStorage.getItem(KEY)
    return (stored && known[stored]) || 'room'
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
