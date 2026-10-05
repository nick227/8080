import React from 'react'
import { createRoot } from 'react-dom/client'
import { CameraPreview } from '../../src/features/CameraPreview'
import { useMediaCapture } from '../../src/features/useMediaCapture'
import { useCapture } from '../../src/state/capture'
import { useBackground } from '../../src/state/background'

useBackground.setState({ mode: 'original' })
function Harness() {
  const capture = useMediaCapture()
  const phase = useCapture(s => s.phase)
  const error = useCapture(s => s.error)
  return <>
    {phase !== 'review' && <CameraPreview deviceId="" recording={phase === 'recording'} />}
    <button onClick={() => void capture.start('video')}>Start</button>
    <button onClick={capture.stop}>Stop</button>
    <button onClick={capture.cancel}>Cancel</button>
    <output data-phase>{phase}</output><output data-error>{error}</output>
  </>
}
createRoot(document.getElementById('root')!).render(<Harness />)
