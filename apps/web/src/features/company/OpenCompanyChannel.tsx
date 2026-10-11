import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOpenWorkspaceChannel } from '@project/sdk'

// Stream on a company page: the company's one shared channel. Choosing Stream is a
// deliberate open, so it joins you to the channel if needed, then shows its room.
export function OpenCompanyChannel({ workspaceId }: { workspaceId: string }) {
  const open = useOpenWorkspaceChannel()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    open.mutate(workspaceId, {
      onSuccess: ({ roomId }) => navigate(`/room/${roomId}`, { replace: true }),
      onError: (err) => setError(err instanceof Error ? err.message : 'Couldn’t open the company channel.'),
    })
  }, [open, workspaceId, navigate])
  return error
    ? <p className="work-empty" role="alert">{error}</p>
    : <p className="work-empty" role="status">Opening the company channel…</p>
}
