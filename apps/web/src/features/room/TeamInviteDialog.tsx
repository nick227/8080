import { useEffect, useRef, useState } from 'react'

export function TeamInviteDialog({ inviteUrl, onClose }: { inviteUrl: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator.share === 'function'

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => {
      dialog.current?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const share = async () => {
    try {
      await navigator.share({ title: 'Join my team', text: 'Join me in this workspace.', url: inviteUrl })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  return (
    <dialog className="team-invite-dialog" ref={dialog} aria-labelledby="team-invite-title" onCancel={(event) => {
      event.preventDefault()
      onClose()
    }}>
      <header>
        <div>
          <h2 id="team-invite-title">Add people</h2>
          <p>Share this link to invite someone to the team.</p>
        </div>
        <button type="button" className="team-invite-close" onClick={onClose} aria-label="Close invite">✕</button>
      </header>
      <div className="team-invite-link">
        <input aria-label="Shareable invite URL" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
        <button type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      {canShare && <button type="button" className="team-invite-share" onClick={() => void share()}>Share invite</button>}
      <div className="team-invite-email" aria-disabled="true">
        <label htmlFor="team-invite-email">Invite by email</label>
        <div><input id="team-invite-email" type="email" placeholder="name@company.com" disabled /><button type="button" disabled>Send invite</button></div>
        <small>Email invitations are coming soon.</small>
      </div>
    </dialog>
  )
}
