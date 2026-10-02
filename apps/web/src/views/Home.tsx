import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '../components/Panel'
import { Label } from '../components/Label'
import { Control } from '../components/Control'
import { StageChrome } from '../components/StageChrome'
import { replyFromUIState } from '../api/sendMedia'
import type { SendInput } from '../api/types'
import { useUI } from '../state/ui'
import { useShell } from '../state/shell'
import { useData } from '../state/data'
import { useCapture } from '../state/capture'
import { RecordSurface } from '../features/room/RecordSurface'
import { SEO } from '../components/SEO'
import { abandon, attachmentThumb, createConversation, type Progress, type ThumbChoice } from '../features/conversation/newConversation'
import { videoFrame } from '../utils/thumbnail'
import '../features/room/room.css'

const REPLYING = new Set(['replying', 'composing', 'recording', 'reviewing'])

// The still from a captured video, offered as the conversation's thumbnail until one
// is picked. Recomputed per take; a slower, older still never replaces a newer one.
function useCaptureStill(): ThumbChoice | null {
  const blob = useCapture((s) => s.blob)
  const mode = useCapture((s) => s.mode)
  const durationMs = useCapture((s) => s.durationMs)
  const [still, setStill] = useState<ThumbChoice | null>(null)
  useEffect(() => {
    setStill(null)
    if (!blob || mode !== 'video') return
    let current = true
    let url: string | null = null
    void videoFrame(blob, durationMs / 1000).then((frame) => {
      if (!current || !frame) return
      url = URL.createObjectURL(frame)
      setStill({ kind: 'file', file: frame, preview: url })
    })
    return () => { current = false; if (url) URL.revokeObjectURL(url) }
  }, [blob, mode, durationMs])
  return still
}

export function Home() {
  const ui = useUI()
  const navigate = useNavigate()
  const surface = useShell((s) => s.surface)
  const replyName = useData((s) => {
    if (!REPLYING.has(ui.state) || !ui.activeItemId) return undefined
    return s.itemsById[ui.activeItemId]?.author.name
  })

  // The new conversation's name, description and picked thumbnail.
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState<ThumbChoice | null>(null)
  const still = useCaptureStill()
  const progress = useRef<Progress>({})
  useEffect(() => () => { if (picked?.kind === 'file') URL.revokeObjectURL(picked.preview) }, [picked])

  const resetDraft = () => {
    setTitle('')
    setDescription('')
    setPicked(null)
    progress.current = {}
  }

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const record = params.get('record') === '1'
    useShell.getState().enterHome(!record)
    if (!record) return
    params.delete('record')
    const next = params.toString()
    window.history.replaceState(null, '', next ? `/?${next}` : '/')
  }, [])

  const handleSend = async (input: SendInput) => {
    // A reply still in progress (started in a room, then navigated here) goes to its parent, not a new post.
    if (await replyFromUIState(input)) return
    const thumb = picked ?? still ?? attachmentThumb(input.media)
    const missing = [!title.trim() && 'a name', !description.trim() && 'a description', !thumb && 'a picture'].filter(Boolean)
    if (missing.length) throw new Error(`Give the conversation ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}`)
    const room = await createConversation({ title, description, thumb: thumb! }, input, progress.current)
    resetDraft()
    navigate(`/room/${room.id}`)
  }

  const identity = {
    title,
    thumbUrl: (picked ?? still)?.preview ?? null,
    onTitle: setTitle,
    onThumb: (file: File) => setPicked({ kind: 'file', file, preview: URL.createObjectURL(file) }),
    description,
    onDescription: setDescription,
  }

  return (
    <Panel as="main" variant="shell" className="stage">
      <SEO title="Home - Voice Chat" description="Welcome to Voice Chat. Create a room and start talking." />
      <StageChrome />
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
            style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 10 }}
          >
            <RecordSurface
              title="New conversation"
              identity={identity}
              replyName={replyName}
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
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}
