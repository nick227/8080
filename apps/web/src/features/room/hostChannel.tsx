import { createContext, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMyWorkspaces, useOpenWorkspaceChannel, useRoomBots } from '@project/sdk'

// chatbot's tile opens the workspace's shared channel (doc/12 §3). Room provides who
// the host is here; the host's tile shows the control.
const HOST_HANDLE = 'chatbot'

type HostChannel = { hostId?: string; busy?: boolean; open?: () => void }
const Context = createContext<HostChannel>({})
export const HostChannelProvider = Context.Provider

export function useHostChannel(roomId: string | undefined): HostChannel {
  const bots = useRoomBots(roomId)
  const workspaces = useMyWorkspaces()
  const openChannel = useOpenWorkspaceChannel()
  const navigate = useNavigate()
  const hostId = bots.data?.find((b) => b.handle === HOST_HANDLE && b.seated)?.user.id
  const workspaceId = workspaces.data?.[0]?.id
  if (!hostId || !workspaceId) return {}
  return {
    hostId,
    busy: openChannel.isPending,
    open: () => {
      void openChannel.mutateAsync(workspaceId).then(({ roomId: channel }) => {
        if (channel !== roomId) navigate(`/room/${channel}`)
      })
    },
  }
}

export function ChannelButton({ seatId }: { seatId: string }) {
  const { hostId, busy, open } = useContext(Context)
  if (!open || seatId !== hostId) return null
  return (
    <button type="button" className="room-channel-link" disabled={busy} onClick={open}>
      Channel
    </button>
  )
}
