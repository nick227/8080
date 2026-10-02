import { useLayoutEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { useCreateRoom, getApiClient, useSession, ApiError } from '@project/sdk'
import { Panel } from '../components/Panel'
import { Label } from '../components/Label'
import { Control } from '../components/Control'
import { StageChrome } from '../components/StageChrome'
import { replyFromUIState, resolveMediaIds } from '../api/sendMedia'
import type { SendInput } from '../api/types'
import { useUI } from '../state/ui'
import { useShell } from '../state/shell'
import { useData } from '../state/data'
import { useCapture } from '../state/capture'
import { RecordSurface } from '../features/room/RecordSurface'
import { SEO } from '../components/SEO'
import '../features/room/room.css'

const REPLYING = new Set(['replying', 'composing', 'recording', 'reviewing'])

export function Home() {
  const ui = useUI()
  const session = useSession()
  const createRoom = useCreateRoom()
  const navigate = useNavigate()
  const surface = useShell((s) => s.surface)
  const replyName = useData((s) => {
    if (!REPLYING.has(ui.state) || !ui.activeItemId) return undefined
    return s.itemsById[ui.activeItemId]?.author.name
  })

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
    const defaultTitle = `Post by ${session.data?.data.displayName ?? 'Anonymous'}`
    const room = await createRoom.mutateAsync({ title: defaultTitle, visibility: 'public' })

    const mediaIds = await resolveMediaIds(input.media)

    const result = await getApiClient().POST('/rooms/{roomId}/items', {
      params: { path: { roomId: room.id } },
      body: {
        text: input.text,
        mediaIds: mediaIds.length ? mediaIds : undefined,
      },
    })

    if (result.error) {
      const body = result.error as { error?: string }
      throw new ApiError(result.response.status, body.error ?? 'Failed to send item')
    }

    navigate(`/room/${room.id}`)
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
              replyName={replyName}
              onActivity={() => {}}
              onClose={() => {
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
