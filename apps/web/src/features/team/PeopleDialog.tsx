import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  useCreateWorkspaceInvite,
  useMyEntitlements,
  useRemoveWorkspaceMember,
  useRevokeWorkspaceInvite,
  useSession,
  useUpdateWorkspaceMember,
  useWorkspaceInvites,
  useWorkspaceMembers,
  type WorkspaceMember,
} from '@project/sdk'
import './peopleDialog.css'

/** What the dialog needs of a company: which one, its name, and the viewer's role in it. */
type Workspace = { id: string; name: string; role: string }

/**
 * The one place people are added to a company and their access is set: Company,
 * Work › Members and a room's Team all open this. Owners and admins invite by email
 * (Premium: the server sends the link; it's always shown once to copy), resend or withdraw
 * pending invites, and change roles. Everyone else sees who's here.
 * In a room, `roomUrl` adds the room's own share link (that opens the room; it
 * doesn't make anyone a member of the company).
 */
export function PeopleDialog({ workspace, roomUrl, onClose }: { workspace: Workspace | null; roomUrl?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => {
      dialog.current?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin'
  // Sending email is Premium (the server checks too); free plans create the link to copy.
  const access = useMyEntitlements(canManage)
  const canEmail = access.data?.tier === 'premium'

  return (
    <dialog className="people-dialog" ref={dialog} aria-labelledby="people-dialog-title" onCancel={(event) => {
      event.preventDefault()
      onClose()
    }}>
      <header className="people-dialog-head">
        <div>
          <h2 id="people-dialog-title">Add people</h2>
          <p>{workspace ? `Invite people to ${workspace.name} and choose what they can do.` : 'Share this room with someone.'}</p>
        </div>
        <button type="button" className="people-dialog-close" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <div className="people-dialog-body">
        {workspace && (canManage
          ? <InviteByEmail workspaceId={workspace.id} canEmail={canEmail} />
          : <p className="people-muted">Only owners and admins can invite people or change roles in {workspace.name}.</p>)}
        {workspace && canManage && <PendingInvites workspaceId={workspace.id} canEmail={canEmail} />}
        {workspace && <People workspace={workspace} canManage={canManage} />}
        {roomUrl && <RoomLink url={roomUrl} />}
      </div>
    </dialog>
  )
}

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const

const PROBLEM: Record<string, string> = {
  ALREADY_MEMBER: 'That person is already a member.',
  LAST_OWNER: 'A company needs at least one owner. Make someone else owner first.',
}

const problem = (err: unknown, fallback: string) =>
  (err instanceof ApiError && err.code && PROBLEM[err.code]) || (err instanceof Error && err.message) || fallback

const inviteLink = (token: string) => `${window.location.origin}/invite/${encodeURIComponent(token)}`

function CopyButton({ text, label = 'Copy link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className="people-btn" onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      })
    }}>{copied ? 'Copied' : label}</button>
  )
}

type Sent = { email: string; link: string; emailed: boolean; emailError: string | null }

function InviteByEmail({ workspaceId, canEmail }: { workspaceId: string; canEmail: boolean }) {
  const create = useCreateWorkspaceInvite(workspaceId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [sent, setSent] = useState<Sent | null>(null)
  const [error, setError] = useState('')

  return (
    <section className="people-section" aria-labelledby="people-invite-title">
      <h3 id="people-invite-title">{canEmail ? 'Invite by email' : 'Invite someone'}</h3>
      <form className="people-invite-form" onSubmit={(e) => {
        e.preventDefault()
        const to = email.trim()
        setError('')
        setSent(null)
        create.mutate({ email: to, role, sendEmail: canEmail }, {
          onSuccess: (res) => {
            setSent({ email: to, link: inviteLink(res.token), emailed: res.emailed, emailError: res.emailError })
            setEmail('')
          },
          onError: (err) => setError(problem(err, 'Couldn’t create the invite.')),
        })
      }}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" aria-label="Email address" />
        <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')} aria-label="Role">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className="people-btn people-btn-primary" disabled={create.isPending}>{create.isPending ? (canEmail ? 'Sending…' : 'Creating…') : canEmail ? 'Send invite' : 'Create invite link'}</button>
      </form>
      <small className="people-muted">Members work in the company. Admins can also invite people and change roles.</small>
      {!canEmail && <small className="people-muted people-premium">Sending invites by email is a Premium feature. You’ll get a link to copy and send yourself.</small>}
      {error && <p className="people-error" role="alert">{error}</p>}
      {sent && (
        <div className="people-sent" role="status">
          <p>
            {sent.emailed
              ? <>Invite sent to <strong>{sent.email}</strong>. You can also copy the link and send it yourself.</>
              : !sent.emailError || sent.emailError === 'PREMIUM_REQUIRED'
                ? <>Invite created for <strong>{sent.email}</strong>. Copy the link and send it to them.</>
                : <>The email to <strong>{sent.email}</strong> couldn’t be sent{sent.emailError === 'NO_APP_URL' ? ' (email isn’t set up here)' : ''}. Copy the link and send it yourself.</>}
            {' '}It works for that address only, and it’s shown just once.
          </p>
          <div className="people-link">
            <input readOnly value={sent.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={sent.link} />
          </div>
        </div>
      )}
    </section>
  )
}

function PendingInvites({ workspaceId, canEmail }: { workspaceId: string; canEmail: boolean }) {
  const invites = useWorkspaceInvites(workspaceId)
  const resend = useCreateWorkspaceInvite(workspaceId)
  const revoke = useRevokeWorkspaceInvite(workspaceId)
  const [note, setNote] = useState<{ id: string; text: string } | null>(null)
  const pending = (invites.data ?? []).filter((i) => new Date(i.expiresAt).getTime() > Date.now())
  if (!pending.length) return null
  return (
    <section className="people-section" aria-labelledby="people-pending-title">
      <h3 id="people-pending-title">Pending invites <span className="people-count">{pending.length}</span></h3>
      <ul className="people-list">
        {pending.map((i) => (
          <li key={i.id}>
            <span className="people-who">
              <span className="people-name">{i.email}</span>
              <span className="people-muted">
                {note?.id === i.id ? note.text : `${ROLE_LABEL[i.role]} · expires ${new Date(i.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
              </span>
            </span>
            <span className="people-actions">
              {/* Without email, a new invite would only replace the link: re-invite from the form instead. */}
              {canEmail && <button type="button" className="people-btn" disabled={resend.isPending} onClick={() => {
                resend.mutate({ email: i.email, role: i.role === 'admin' ? 'admin' : 'member', sendEmail: true }, {
                  onSuccess: (res) => setNote({ id: res.data.id, text: res.emailed ? 'Sent again' : 'Couldn’t email it' }),
                  onError: (err) => setNote({ id: i.id, text: problem(err, 'Couldn’t resend.') }),
                })
              }}>Resend</button>}
              <button type="button" className="people-btn" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>Withdraw</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function People({ workspace, canManage }: { workspace: Workspace; canManage: boolean }) {
  const members = useWorkspaceMembers(workspace.id)
  const meId = useSession().data?.data.id
  const people = (members.data ?? []).filter((m) => m.status !== 'removed')
  return (
    <section className="people-section" aria-labelledby="people-members-title">
      <h3 id="people-members-title">People <span className="people-count">{members.isLoading ? '' : people.length}</span></h3>
      {members.isError && !members.data ? (
        <p className="people-error" role="alert">People couldn’t load. <button type="button" className="people-btn" onClick={() => void members.refetch()}>Retry</button></p>
      ) : (
        <ul className="people-list">
          {people.map((m) => <PersonRow key={m.id} workspace={workspace} member={m} self={m.user.id === meId} canManage={canManage} />)}
        </ul>
      )}
    </section>
  )
}

function PersonRow({ workspace, member, self, canManage }: { workspace: Workspace; member: WorkspaceMember; self: boolean; canManage: boolean }) {
  const update = useUpdateWorkspaceMember(workspace.id)
  const remove = useRemoveWorkspaceMember(workspace.id)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  // Only owners touch owners or make owners (the server enforces the same rule).
  const iOwn = workspace.role === 'owner'
  const editable = canManage && !self && (iOwn || member.role !== 'owner')
  const roles = iOwn ? (['member', 'admin', 'owner'] as const) : (['member', 'admin'] as const)

  return (
    <li>
      <span className="people-who">
        {member.user.avatarUrl ? <img src={member.user.avatarUrl} alt="" className="people-avatar" /> : <span className="people-avatar" aria-hidden="true">{member.user.name.slice(0, 1).toUpperCase()}</span>}
        <span>
          <span className="people-name">{member.user.name}{self && <small className="people-self">You</small>}</span>
          <span className="people-muted">{member.email ?? ''}{member.status === 'suspended' ? ' · Suspended' : ''}</span>
          {error && <span className="people-error" role="alert">{error}</span>}
        </span>
      </span>
      <span className="people-actions">
        {editable ? (
          <select
            value={member.role}
            aria-label={`Role for ${member.user.name}`}
            disabled={update.isPending}
            onChange={(e) => {
              setError('')
              update.mutate({ memberId: member.id, role: e.target.value as WorkspaceMember['role'] }, { onError: (err) => setError(problem(err, 'Couldn’t change the role.')) })
            }}
          >
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        ) : (
          <span className="people-role">{ROLE_LABEL[member.role]}</span>
        )}
        {editable && (confirming ? (
          <>
            <button type="button" className="people-btn people-btn-danger" disabled={remove.isPending} onClick={() => {
              setError('')
              remove.mutate(member.id, { onError: (err) => { setConfirming(false); setError(problem(err, 'Couldn’t remove them.')) } })
            }}>Remove</button>
            <button type="button" className="people-btn" onClick={() => setConfirming(false)}>Keep</button>
          </>
        ) : (
          <button type="button" className="people-btn" aria-label={`Remove ${member.user.name}`} onClick={() => setConfirming(true)}>Remove</button>
        ))}
      </span>
    </li>
  )
}

function RoomLink({ url }: { url: string }) {
  const canShare = typeof navigator.share === 'function'
  return (
    <section className="people-section" aria-labelledby="people-room-title">
      <h3 id="people-room-title">Room link</h3>
      <small className="people-muted">Opens this room. It doesn’t add anyone to the company.</small>
      <div className="people-link">
        <input readOnly value={url} aria-label="Room link" onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={url} />
        {canShare && (
          <button type="button" className="people-btn" onClick={() => {
            navigator.share({ title: 'Join me', text: 'Join me in this room.', url }).catch(() => { /* dismissed */ })
          }}>Share</button>
        )}
      </div>
    </section>
  )
}
