import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLinkCompanyConversation, useRoom, useRoomCompany, useSession, useUnlinkCompanyConversation, useMyWorkspaces } from '@project/sdk'
import { useCurrentWorkspace } from '../../app/workspace'

/**
 * Which company this conversation is listed under (redesign D3). Listing never changes
 * who can see the room. Its owner can add it to the current company; the owner or a
 * company admin can remove it. The company channel is always listed.
 */
export function RoomCompany({ roomId }: { roomId: string }) {
  const me = useSession().data?.data.id
  const room = useRoom(roomId).data
  const company = useRoomCompany(roomId).data
  const { workspace } = useCurrentWorkspace()
  const memberships = useMyWorkspaces().data ?? []
  const target = company?.id ?? workspace?.id ?? ''
  const link = useLinkCompanyConversation(target)
  const unlink = useUnlinkCompanyConversation(target)
  const [error, setError] = useState('')
  if (!room || !me) return null
  const owner = room.ownerId === me
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'That didn’t work.')

  if (company) {
    const role = memberships.find((m) => m.id === company.id)?.role
    const canRemove = !company.channel && (owner || role === 'owner' || role === 'admin')
    return (
      <span className="room-company">
        <Link to={`/c/${company.id}/conversations`} title={`Listed in ${company.name}`}>In {company.name}</Link>
        {canRemove && (
          <button type="button" disabled={unlink.isPending} onClick={() => { setError(''); unlink.mutate(roomId, { onError: fail }) }}>
            Remove
          </button>
        )}
        {error && <span className="room-company-error" role="alert">{error}</span>}
      </span>
    )
  }
  if (!owner || !workspace) return null
  return (
    <span className="room-company">
      <button type="button" disabled={link.isPending} onClick={() => { setError(''); link.mutate(roomId, { onError: fail }) }}>
        {link.isPending ? 'Adding…' : `Add to ${workspace.name}`}
      </button>
      {error && <span className="room-company-error" role="alert">{error}</span>}
    </span>
  )
}
