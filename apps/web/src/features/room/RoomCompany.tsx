import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLinkCompanyConversation, useRoom, useRoomCompany, useSession, useUnlinkCompanyConversation, useMyWorkspaces, useUpdateRoom } from '@project/sdk'
import { useCurrentWorkspace } from '../../app/workspace'

/**
 * The room's own settings beside its Stream: public/private (owner) and which company
 * it is listed under (redesign D3). Listing never changes
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
  const update = useUpdateRoom(roomId)
  const [error, setError] = useState('')
  if (!room || !me) return null
  const owner = room.ownerId === me
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'That didn’t work.')
  // Saves on change: the room's own setting, so it lives with the room (not the company).
  const visibility = owner ? (
    <label className="room-visibility" title="Who can see this conversation">
      <span aria-hidden>Conversation:</span>
      <select
        aria-label="Who can see this conversation"
        value={room.visibility}
        disabled={update.isPending}
        onChange={(e) => { setError(''); update.mutate({ visibility: e.target.value as 'public' | 'private' }, { onError: fail }) }}
      >
        <option value="public">Public</option>
        <option value="private">Private</option>
      </select>
    </label>
  ) : null

  // Listed under a company you aren't in: only the conversation's own setting (D8).
  if (company && !company.member) return visibility ? <span className="room-company">{visibility}{error && <span className="room-company-error" role="alert">{error}</span>}</span> : null
  if (company) {
    const role = memberships.find((m) => m.id === company.id)?.role
    const canRemove = !company.channel && (owner || role === 'owner' || role === 'admin')
    return (
      <span className="room-company">
        {visibility}
        <Link to={`/c/${company.id!}/conversations`} title={`Listed in ${company.name}`}>In {company.name}</Link>
        {canRemove && (
          <button type="button" disabled={unlink.isPending} onClick={() => { setError(''); unlink.mutate(roomId, { onError: fail }) }}>
            Remove
          </button>
        )}
        {error && <span className="room-company-error" role="alert">{error}</span>}
      </span>
    )
  }
  if (!owner) return null
  if (!workspace) return <span className="room-company">{visibility}{error && <span className="room-company-error" role="alert">{error}</span>}</span>
  return (
    <span className="room-company">
      {visibility}
      <button type="button" disabled={link.isPending} onClick={() => { setError(''); link.mutate(roomId, { onError: fail }) }}>
        {link.isPending ? 'Adding…' : `Add to ${workspace.name}`}
      </button>
      {error && <span className="room-company-error" role="alert">{error}</span>}
    </span>
  )
}
