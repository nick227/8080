import { useState } from 'react'
import { usePeers } from './presence'
import './active-users.css'

export function ActiveUsersWidget({ max = 4 }: { max?: number }) {
  const peers = usePeers()
  const [expanded, setExpanded] = useState(false)

  if (peers.length === 0) return null

  const displayPeers = expanded ? peers : peers.slice(0, max)
  const remaining = peers.length - max

  return (
    <div className="active-users-widget">
      <div className="active-users-bank">
        {displayPeers.map((peer) => (
          <div key={peer.clientId} className="active-user-avatar" title={`${peer.name} (${peer.activity})`}>
            {peer.name.charAt(0).toUpperCase()}
          </div>
        ))}
        {!expanded && remaining > 0 && (
          <button 
            type="button" 
            className="active-user-avatar active-user-more"
            onClick={() => setExpanded(true)}
          >
            +{remaining}
          </button>
        )}
      </div>
      {expanded && remaining > 0 && (
        <button className="active-user-collapse" onClick={() => setExpanded(false)}>
          Collapse
        </button>
      )}
    </div>
  )
}
