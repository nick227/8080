import { WorkspaceLoading } from '../work/WorkspaceTransition'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useOpenWorkspaceChannel } from '@project/sdk'
import { prepareTeamRoom } from './prepareTeamRoom'

// Opening Team joins its channel, then hands off once the room layout is ready.
export function OpenCompanyChannel({ workspaceId }: { workspaceId: string }) {
  const { mutateAsync } = useOpenWorkspaceChannel()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const request = useRef<{ workspaceId: string; attempt: number; promise: Promise<string> } | null>(null)
  useEffect(() => {
    let active = true
    // Reuse the request during Strict Mode's effect replay.
    if (!request.current || request.current.workspaceId !== workspaceId || request.current.attempt !== attempt) {
      request.current = { workspaceId, attempt, promise: mutateAsync(workspaceId).then(async ({ roomId }) => {
        await prepareTeamRoom(client, roomId)
        return roomId
      }) }
    }
    void request.current.promise.then(
      (roomId) => { if (active) navigate(`/room/${roomId}`, { replace: true }) },
      (err) => { if (active) setError(err instanceof Error ? err.message : 'Couldn’t open the company channel.') },
    )
    // A late channel response must not pull someone back after they choose another tab.
    return () => { active = false }
  }, [mutateAsync, client, workspaceId, attempt, navigate])
  return error
    ? <p className="work-empty" role="alert">{error} <button type="button" className="cal-link-btn" onClick={() => { setError(''); setAttempt(n => n + 1) }}>Retry</button></p>
    : <WorkspaceLoading label="Opening team…" />
}
