import { create } from 'zustand'

// The chat panel's visibility, shared by ChatShell (which draws it) and the header's
// chat control (its only entry point, D10). `hosts` counts mounted ChatShells, so the
// control shows only where a chat context exists. The panel overlays the page, so it
// starts closed (it would cover the page's own controls); on wide screens the viewer's
// last choice wins. On phones, where it covers the whole work area, it always starts
// closed and the choice isn't saved.
export type ChatMode = 'closed' | 'open' | 'full'

// New key with the overlay (2026-10-12): the old side-by-side default doesn't carry over.
const KEY = 'vc-chat-panel'
export const PHONE_CHAT = '(max-width: 860px)'

export const isPhoneChat = () => typeof window !== 'undefined' && window.matchMedia?.(PHONE_CHAT).matches === true

function load(): ChatMode {
  if (isPhoneChat()) return 'closed'
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'open' || saved === 'full' ? saved : 'closed'
  } catch { return 'closed' }
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
