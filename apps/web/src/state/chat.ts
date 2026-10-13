import { create } from 'zustand'

// The chat panel's visibility, shared by ChatShell (which draws it) and the header's
// chat control (its only entry point, D10). `hosts` counts mounted ChatShells, so the
// control shows only where a chat context exists.
export type ChatMode = 'closed' | 'open' | 'full'

const KEY = 'vc-chat-open'

function load(): ChatMode {
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
    try { localStorage.setItem(KEY, mode) } catch { /* the choice still applies for this visit */ }
    set({ mode })
  },
  toggle: () => get().setMode(get().mode === 'closed' ? 'open' : 'closed'),
}))
