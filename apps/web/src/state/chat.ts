import { create } from 'zustand'

// The chat panel's visibility, shared by ChatShell (which draws it) and the header's
// chat control (its only entry point, D10). `hosts` counts mounted ChatShells, so the
// control shows only where a chat context exists. Wide screens: open by default, docked
// beside the page (room.css); the viewer's last choice wins. Narrower screens float it
// over the page. Phones, where it covers the whole work area, always start closed and
// don't save the choice.
export type ChatMode = 'closed' | 'open' | 'full'

const KEY = 'vc-chat-open'
export const PHONE_CHAT = '(max-width: 860px)'

export const isPhoneChat = () => typeof window !== 'undefined' && window.matchMedia?.(PHONE_CHAT).matches === true

function load(): ChatMode {
  if (isPhoneChat()) return 'closed'
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'closed' || saved === 'full' ? saved : 'open'
  } catch { return 'open' }
}

type ChatPanel = {
  mode: ChatMode
  unseen: number
  hosts: number
  setMode: (mode: ChatMode) => void
  toggle: () => void
}

export const useChatPanel = create<ChatPanel>((set, get) => ({
  mode: load(),
  unseen: 0,
  hosts: 0,
  setMode: (mode) => {
    if (!isPhoneChat()) {
      try { localStorage.setItem(KEY, mode) } catch { /* the choice still applies for this visit */ }
    }
    set({ mode })
  },
  toggle: () => get().setMode(get().mode === 'closed' ? 'open' : 'closed'),
}))
