import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap, type User } from '@project/sdk'

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp'

export function AccountAvatar({ user, onError }: { user: User; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const editable = !user.isGuest
  const mark = user.displayName.trim().slice(0, 1).toUpperCase()

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    onError('')
    const form = new FormData()
    form.append('file', file)
    try {
      const updated = unwrap(await getApiClient().POST('/users/me/avatar', {
        body: form as never,
        bodySerializer: () => form,
      }))
      qc.setQueryData(['me'], updated)
      await qc.invalidateQueries({ queryKey: ['items'] })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Unable to save')
    } finally {
      setBusy(false)
    }
  }

  const frame = (
    <span className="account-avatar-frame">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{mark}</span>}
    </span>
  )

  if (!editable) {
    return (
      <div className="account-avatar" data-static="">
        {frame}
      </div>
    )
  }

  return (
    <label className="account-avatar">
      {frame}
      <span className="account-text">{busy ? 'Saving' : 'Change'}</span>
      <input
        className="account-avatar-input"
        type="file"
        accept={ACCEPT}
        disabled={busy}
        aria-label="Change avatar"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void pick(file)
        }}
      />
    </label>
  )
}
