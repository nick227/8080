import type { ReactNode } from 'react'

export function ChatShell({ header, stage, stream, dock }: {
  header: ReactNode
  stage: ReactNode
  stream: ReactNode
  dock: ReactNode
}) {
  return (
    <div className="room-chat">
      {header}
      {stage}
      <div className="room-rail">
        {stream}
        {dock}
      </div>
    </div>
  )
}
