import { create } from 'zustand'

export type Surface = 'record' | 'lobby' | 'conversation'

export type CrumbRoom = {
  title: string
  number?: number
  visibility?: string
}

type ShellState = {
  surface: Surface
  place: 'home' | 'room'
  accountOpen: boolean
  room: CrumbRoom | null
  enterHome: (lobby?: boolean) => void
  enterRoom: () => void
  openRecord: () => void
  minimizeRecord: () => void
  showLobby: () => void
  toggleLobby: () => void
  toggleAccount: () => void
  showConversation: () => void
  setRoom: (room: CrumbRoom | null) => void
}

const inRoom = typeof window !== 'undefined' && /^\/room\//.test(window.location.pathname)

export const useShell = create<ShellState>((set, get) => ({
  surface: inRoom ? 'conversation' : 'record',
  place: inRoom ? 'room' : 'home',
  accountOpen: false,
  room: null,

  enterHome: (lobby) => set({ place: 'home', surface: lobby ? 'lobby' : 'record', accountOpen: false }),
  enterRoom: () => set({ place: 'room', surface: 'conversation', accountOpen: false }),
  openRecord: () => set({ surface: 'record', accountOpen: false }),
  showLobby: () => set({ surface: 'lobby', accountOpen: false }),
  // Home falls back to the directory. A room falls back to its conversation.
  minimizeRecord: () => set({ surface: get().place === 'room' ? 'conversation' : 'lobby' }),
  toggleLobby: () => {
    const { surface, place } = get()
    set({
      surface: surface === 'lobby' ? (place === 'room' ? 'conversation' : 'record') : 'lobby',
      accountOpen: false,
    })
  },
  toggleAccount: () => set({ accountOpen: !get().accountOpen }),
  showConversation: () => set({ place: 'room', surface: 'conversation', accountOpen: false }),
  setRoom: (room) => set({ room }),
}))
