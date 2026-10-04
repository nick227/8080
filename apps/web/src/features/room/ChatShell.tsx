import type { ReactNode } from 'react'
import type { RoomView } from './roomViews'

export function ChatShell({ header, stage, stream, view }: {
  header: ReactNode
  stage: ReactNode
  stream: ReactNode
  view: RoomView
}) {
  return (
    <div className="room-chat" data-view={view}>
      {header}
      {stage}
      <div className="room-rail">{stream}</div>
    </div>
  )
}
