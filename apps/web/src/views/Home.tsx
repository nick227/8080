import { useLayoutEffect } from 'react'
import { useCreateRoom, getApiClient, useSession, ApiError } from '@project/sdk'
import { Panel } from '../components/Panel'
import { Label } from '../components/Label'
import { Control } from '../components/Control'
import { StageChrome } from '../components/StageChrome'
import { Instrument } from '../features/Instrument'
import { replyFromUIState, resolveMediaIds } from '../api/sendMedia'
import type { SendInput } from '../api/types'
import { useUI } from '../state/ui'
import { useShell } from '../state/shell'

export function Home() {
  const ui = useUI()
  const session = useSession()
  const createRoom = useCreateRoom()

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lobby = params.get('lobby') === '1'
    useShell.getState().enterHome(lobby)
    if (!lobby) return
    params.delete('lobby')
    const next = params.toString()
    window.history.replaceState(null, '', next ? `/?${next}` : '/')
  }, [])

  const handleSend = async (input: SendInput) => {
    // A reply started from the River (REPLY / REPLY HERE) goes to its parent, not a new post.
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

    window.location.href = `/room/${room.id}`
  }

  return (
    <Panel as="main" variant="shell" className="stage">
      <StageChrome />
      {ui.error && (
        <Label variant="status" className="error" role="alert">
          {ui.error}
          <Control onClick={() => ui.setError(undefined)}>×</Control>
        </Label>
      )}
      <Instrument onSend={handleSend} />
    </Panel>
  )
}
