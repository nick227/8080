import { useLayoutEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, useAcceptWorkspaceInvite, useSession } from '@project/sdk'
import { Panel } from '../components/Panel'
import { SEO } from '../components/SEO'
import { StageChrome } from '../components/StageChrome'
import { chooseWorkspace } from '../app/workspace'
import { GuestAuth } from '../features/AccountSheet'
import { useShell } from '../state/shell'
import '../features/room/room.css'

const PROBLEM: Record<string, string> = {
  INVITE_EMAIL_MISMATCH: 'This invite was sent to a different email address. Sign in with that address to accept it.',
  INVITE_INVALID: 'This invite is no longer valid (expired, withdrawn or already used). Ask for a new one.',
}

// /invite/:token — join a company from an invite link (redesign D9, Team's "+ Invite").
export function Invite() {
  const { token = '' } = useParams()
  const user = useSession().data?.data
  const accept = useAcceptWorkspaceInvite()
  const navigate = useNavigate()
  const [problem, setProblem] = useState('')
  useLayoutEffect(() => { useShell.getState().enterRoom() }, [])

  const join = () => {
    setProblem('')
    accept.mutate(token, {
      onSuccess: (ws) => { chooseWorkspace(ws.id); navigate(`/c/${ws.id}`) },
      onError: (err) => {
        const code = err instanceof ApiError ? err.code : undefined
        setProblem((code && PROBLEM[code]) || (err instanceof Error ? err.message : 'Couldn’t accept the invite.'))
      },
    })
  }

  return (
    <Panel as="main" variant="shell" className="room-shell">
      <SEO title="Join a company - 8080" description="Accept an invite" />
      <StageChrome />
      <div className="account-page">
        <h1>You’re invited to a company</h1>
        {!user ? null : user.isGuest ? (
          <section aria-label="Sign in">
            <p className="account-muted">Sign in or create an account with the email address the invite was sent to, then accept.</p>
            <GuestAuth user={user} />
          </section>
        ) : (
          <section aria-label="Accept">
            <p className="account-muted">Signed in as {user.email ?? user.displayName}.</p>
            <button type="button" className="account-submit" disabled={accept.isPending} onClick={join}>
              {accept.isPending ? 'Joining…' : 'Accept and join'}
            </button>
            {problem && <p className="account-error" role="alert">{problem}</p>}
            <p><Link className="account-text" to="/account">Not you? Account</Link></p>
          </section>
        )}
      </div>
    </Panel>
  )
}
