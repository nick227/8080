import { useState } from 'react'
import type { Seat } from '../room/roomViews'
import { TeamTableView } from './TeamTableView'
import { UserProfilePage, type ExtendedMember } from './UserProfilePage'
import { AssignTaskModal } from './AssignTaskModal'
import './team.css'

export function TeamDesk({
  seats,
}: {
  seats: Seat[]
  roomId?: string
}) {
  const [selectedUser, setSelectedUser] = useState<ExtendedMember | null>(null)
  const [assignModalUser, setAssignModalUser] = useState<string | null>(null)

  return (
    <div className="team-desk-container">
      {selectedUser ? (
        <UserProfilePage
          member={selectedUser}
          seat={seats.find((s) => s.id === (selectedUser.userId ?? selectedUser.id))}
          onBack={() => setSelectedUser(null)}
          onAssignTask={(userId) => setAssignModalUser(userId)}
        />
      ) : (
        <TeamTableView
          seats={seats}
          onSelectUser={(member) => setSelectedUser(member)}
          onAssignTask={(userId) => setAssignModalUser(userId)}
        />
      )}

      {assignModalUser !== null && (
        <AssignTaskModal
          assigneeId={assignModalUser}
          onClose={() => setAssignModalUser(null)}
        />
      )}
    </div>
  )
}
