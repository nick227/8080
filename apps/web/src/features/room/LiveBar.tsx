import { Control } from '../../components/Control'
import { KindMark } from '../../components/icons'
import type { ReactNode } from 'react'
import type { RecordSession } from './useRecordSession'

// Room controls only. Capture state lives on the record stack, not here.
export function LiveBar({ session, armed, setArmed, onPost, viewSwitch }: {
  session: RecordSession
  armed: boolean
  setArmed: (armed: boolean) => void
  onPost: () => void
  viewSwitch: ReactNode
}) {
  const arm = (next: 'mic' | 'camera') => {
    if (session.recording) return
    if (armed && session.frame === next && !session.showTake) {
      session.discard()
      setArmed(false)
      return
    }
    session.chooseFrame(next)
    setArmed(true)
  }
  return (
    <div className="room-bar">
      <div className="room-bar-controls">
        <Control variant="default" className="sub-control" type="button" aria-label="Post" onClick={() => { if (!session.recording) onPost() }}>Aa</Control>
        <Control variant="default" className="sub-control" type="button" aria-label="Microphone" active={armed && session.frame === 'mic'} onClick={() => arm('mic')}><KindMark kind="audio" /></Control>
        <Control variant="default" className="sub-control" type="button" aria-label="Camera" active={armed && session.frame === 'camera'} onClick={() => arm('camera')}><KindMark kind="video" /></Control>
      </div>
      {viewSwitch}
    </div>
  )
}
