import { useLayoutEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLogout, useSession } from '@project/sdk'
import { Panel } from '../components/Panel'
import { SEO } from '../components/SEO'
import { StageChrome } from '../components/StageChrome'
import { AccountIdentity, CompanyList, GuestAuth, useSaveName } from '../features/AccountSheet'
import { useShell } from '../state/shell'
import '../features/room/room.css'

// The personal account (/account), outside any company (redesign D8, Phase 2): who you
// are, your companies, sign-out. Company roles and work live in each company's Team.
export function Account() {
  const user = useSession().data?.data
  const navigate = useNavigate()
  const logout = useLogout()
  const saveName = useSaveName()
  const [name, setName] = useState(user?.displayName ?? '')
  const [message, setMessage] = useState('')

  useLayoutEffect(() => {
    useShell.getState().enterRoom()
  }, [])

  return (
    <Panel as="main" variant="shell" className="room-shell">
      <SEO title="Account - 8080" description="Your account" />
      <StageChrome />
      <div className="account-page">
        <h1>Account</h1>
        {!user ? null : user.isGuest ? (
          <section aria-label="Sign in">
            <p className="account-muted">You’re a guest. Sign in or create an account to keep your name and join companies.</p>
            <GuestAuth user={user} />
          </section>
        ) : (
          <>
            <section aria-label="Profile">
              <AccountIdentity user={user} onError={setMessage} />
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveName(name).then((error) => setMessage(error || 'Saved.'))
                }}
              >
                <label className="account-field">
                  <span>Name</span>
                  <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <button type="submit" className="account-submit">Save name</button>
                {message && <p className={message === 'Saved.' ? 'account-muted' : 'account-error'} role="status">{message}</p>}
              </form>
            </section>
            <section aria-label="Companies">
              <CompanyList onOpen={(id) => navigate(`/c/${id}`)} />
            </section>
            <section aria-label="Session">
              <button type="button" className="account-text" onClick={() => void logout.mutateAsync().then(() => navigate('/'))}>
                Sign out
              </button>
            </section>
          </>
        )}
      </div>
    </Panel>
  )
}
