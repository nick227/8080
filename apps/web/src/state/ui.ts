import { create } from 'zustand'

export type SpatialState = 'idle' | 'selected' | 'replying' | 'recording' | 'reviewing' | 'playback' | 'composing'

type UIState = {
  state: SpatialState
  activeItemId?: string
  playbackMode?: 'chronological' | 'branch'
  // Moment (ms) captured when the user chose REPLY HERE — carried unchanged through
  // compose/record/review so a long recording can't drift the anchor.
  replyAnchorMs?: number
  error?: string
  
  setIdle: () => void
  selectItem: (id: string) => void
  startReply: (id?: string, anchorMs?: number) => void
  startRecording: () => void
  finishRecording: () => void
  startPlayback: (id: string, mode?: 'chronological' | 'branch') => void
  startComposing: () => void
  setError: (error?: string) => void
}

export const useUI = create<UIState>((set, get) => ({
  state: 'idle',
  activeItemId: undefined,
  playbackMode: undefined,
  error: undefined,

  setIdle: () => set({ state: 'idle', activeItemId: undefined, playbackMode: undefined, replyAnchorMs: undefined, error: undefined }),
  
  selectItem: (id) => set({ state: 'selected', activeItemId: id, replyAnchorMs: undefined, error: undefined }),
  
  startReply: (id, anchorMs) => set((prev) => ({ 
    state: 'replying', 
    activeItemId: id || prev.activeItemId, 
    replyAnchorMs: anchorMs,
    error: undefined 
  })),
  
  startRecording: () => set((prev) => ({ 
    state: 'recording', 
    error: undefined,
    activeItemId: prev.state === 'playback' ? undefined : prev.activeItemId,
    replyAnchorMs: prev.state === 'playback' ? undefined : prev.replyAnchorMs,
  })),
  
  finishRecording: () => set({ state: 'reviewing', error: undefined }),
  
  startPlayback: (id, mode) => set((prev) => ({ 
    state: 'playback', 
    activeItemId: id, 
    playbackMode: mode ?? prev.playbackMode ?? 'chronological',
    replyAnchorMs: undefined,
    error: undefined 
  })),
  
  startComposing: () => set((prev) => ({ 
    state: 'composing', 
    activeItemId: prev.activeItemId,
    error: undefined 
  })),

  setError: (error) => set({ error }),
}))

