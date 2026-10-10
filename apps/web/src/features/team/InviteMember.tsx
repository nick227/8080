import { useState } from 'react'
import { useCreateWorkspaceInvite } from '@project/sdk'

/**
 * Invite someone to the company (redesign D9: Team's "+ New"). The server keeps only a
 * hash of the token, so the link is shown once here to copy and send; it works for the
 * invited email address only.
 */
export function InviteMember({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const create = useCreateWorkspaceInvite(workspaceId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [link, setLink] = useState<{ url: string; email: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  if (link) {
    return (
      <div className="team-invite" role="status">
        <p>Send this link to <strong>{link.email}</strong>. It works for that email address only and is shown just once.</p>
        <div className="team-invite-link">
          <input readOnly value={link.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="collection-row-action" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => setCopied(true)) }}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <div className="team-invite-actions">
          <button type="button" className="section-add-btn" onClick={() => { setLink(null); setEmail(''); setCopied(false) }}>Invite another</button>
          <button type="button" className="section-add-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }
  return (
    <form
      className="team-invite"
      onSubmit={(e) => {
        e.preventDefault()
        setError('')
        create.mutate({ email: email.trim(), role }, {
          onSuccess: (res) => setLink({ url: `${window.location.origin}/invite/${encodeURIComponent(res.token)}`, email: email.trim() }),
          onError: (err) => setError(err instanceof Error ? err.message : 'Couldn’t create the invite.'),
        })
      }}
    >
      <label>
        <span>Email</span>
        <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
      </label>
      <label>
        <span>Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      {error && <p className="room-company-error" role="alert">{error}</p>}
      <div className="team-invite-actions">
        <button type="submit" className="section-add-btn" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create invite link'}</button>
        <button type="button" className="section-add-btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}
