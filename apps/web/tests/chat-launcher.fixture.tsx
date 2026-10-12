import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatShell } from '../src/features/room/ChatShell'
import { ChatStream } from '../src/features/room/ChatStream'
import '../src/features/room/room.css'
localStorage.setItem('vc-chat-open', 'closed')
function Fixture() {
  const [count, setCount] = useState(2)
  const [total, setTotal] = useState(2)
  return <div style={{ height: '100dvh', display: 'flex' }}><ChatShell view="grid" unseenCount={count} stage={<button style={{alignSelf: 'start'}} onClick={() => { setCount(n => n + 1); setTotal(n => n + 1) }}>Incoming</button>} stream={<ChatStream rows={Array.from({length: total}, (_, i) => ({id: String(i), author: 'Sam', text: 'Hello', media: []}))} pin={0} onCaughtUp={() => setCount(0)} />} /></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
