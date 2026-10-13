import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { ChatControl } from '../src/components/ChatControl'
import { ChatShell } from '../src/features/room/ChatShell'
import { ChatStream } from '../src/features/room/ChatStream'
import { useChatPanel } from '../src/state/chat'
import '../src/features/room/room.css'
// Imports run first, so the store has already read storage: start closed explicitly.
useChatPanel.getState().setMode('closed')
function Fixture() {
  const [count, setCount] = useState(2)
  const [total, setTotal] = useState(2)
  const [mounted, setMounted] = useState(true)
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <header className="masthead-fixture"><ChatControl /><button onClick={() => setMounted((m) => !m)}>Leave room</button></header>
    {mounted && <ChatShell view="grid" unseenCount={count} stage={<button style={{alignSelf: 'start'}} onClick={() => { setCount(n => n + 1); setTotal(n => n + 1) }}>Incoming</button>} stream={<ChatStream rows={Array.from({length: total}, (_, i) => ({id: String(i), author: 'Sam', text: 'Hello', media: []}))} pin={0} onCaughtUp={() => setCount(0)} />} />}
  </div>
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><Fixture /></MemoryRouter>)
