import { useLayoutEffect } from 'react'
import { Lobby } from '../features/Lobby'
import { useShell } from '../state/shell'
import { SEO } from '../components/SEO'
import { RecordModalSurface } from '../features/conversation/RecordModalSurface'
import '../features/room/room.css'

export function Conversations() {
  const surface = useShell((s) => s.surface)

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const record = params.get('record') === '1'
    useShell.getState().enterHome(!record)
    if (!record) return
    params.delete('record')
    const next = params.toString()
    window.history.replaceState(null, '', next ? `/conversations?${next}` : '/conversations')
  }, [])

  return (
    <div className="app-page app-rooms">
      <SEO title="Community — 8080" description="Browse conversations or create a conversation with text, voice, and video." />
      {surface !== 'record' && (
        <div className="conversation-directory">
          <div className="product-page-heading">
            <h1>Community</h1>
          </div>
          <Lobby />
        </div>
      )}
      <RecordModalSurface />
    </div>
  )
}
