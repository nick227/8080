import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../state/ui'
import { useShell } from '../../state/shell'
import { useCapture } from '../../state/capture'
import { Label } from '../../components/Label'
import { Control } from '../../components/Control'
import { NewProjectSurface, type ProjectIdentityData } from './NewProjectSurface'
import { RecordSurface } from '../room/RecordSurface'
import { abandon, createConversation, type Progress } from './newConversation'
import type { SendInput } from '../../api/types'

export function RecordModalSurface() {
  const ui = useUI()
  const navigate = useNavigate()
  const surface = useShell((s) => s.surface)
  const [draftIdentity, setDraftIdentity] = useState<ProjectIdentityData | null>(null)
  const progress = useRef<Progress>({})

  const resetDraft = () => {
    setDraftIdentity(null)
    progress.current = {}
  }

  const handleSend = async (input: SendInput) => {
    if (!draftIdentity) return
    const room = await createConversation(
      { title: draftIdentity.title, description: draftIdentity.description, thumb: draftIdentity.thumb },
      input,
      progress.current,
    )
    resetDraft()
    navigate(`/room/${room.id}`)
  }

  const identity = draftIdentity
    ? {
        title: draftIdentity.title,
        thumbUrl: draftIdentity.thumb?.preview ?? null,
        onTitle: (t: string) => setDraftIdentity((prev) => (prev ? { ...prev, title: t } : null)),
        onThumb: (file: File) =>
          setDraftIdentity((prev) =>
            prev ? { ...prev, thumb: { kind: 'file', file, preview: URL.createObjectURL(file) } } : null,
          ),
        description: draftIdentity.description,
        onDescription: (d: string) => setDraftIdentity((prev) => (prev ? { ...prev, description: d } : null)),
      }
    : undefined

  return (
    <>
      {ui.error && (
        <Label variant="status" className="error" role="alert">
          {ui.error}
          <Control onClick={() => ui.setError(undefined)}>×</Control>
        </Label>
      )}
      <AnimatePresence>
        {surface === 'record' && (
          <motion.div
            key="record"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            style={{ width: '100%', height: '100%', position: 'fixed', top: 0, left: 0, zIndex: 50 }}
          >
            {draftIdentity ? (
              <RecordSurface
                title="First Post"
                identity={identity}
                onActivity={() => {}}
                onClose={() => {
                  void abandon(progress.current)
                  resetDraft()
                  useCapture.getState().cancel()
                  ui.setIdle()
                  useShell.getState().minimizeRecord()
                }}
                onSend={async (input) => {
                  try {
                    await handleSend(input)
                    useCapture.getState().complete()
                    ui.setIdle()
                  } catch (e) {
                    ui.setError(`Send failed: ${e instanceof Error ? e.message : 'unknown error'}`)
                  }
                }}
              />
            ) : (
              <NewProjectSurface
                onClose={() => {
                  resetDraft()
                  ui.setIdle()
                  useShell.getState().minimizeRecord()
                }}
                onProceedToRecord={(data) => {
                  setDraftIdentity(data)
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
