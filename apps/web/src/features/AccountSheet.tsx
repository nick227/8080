import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { getApiClient, useLogin, useLogout, useRegister, useSession, type User } from '@project/sdk'
import { AccountAvatar } from './AccountAvatar'
import { useShell } from '../state/shell'

const sheetMotion = {
  initial: { opacity: 0, y: -8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.98 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
}

export function AccountSheet() {
  const open = useShell((s) => s.accountOpen)
  const session = useSession()
  const user = session.data?.data
  return (
    <>
      {open && user && (
        <button type="button" className="sheet-dismiss" aria-label="Close account" onClick={() => useShell.setState({ accountOpen: false })} />
      )}
      <AnimatePresence>
        {open && user && (
          <motion.section key="account" className="account-sheet" role="dialog" aria-label={user.isGuest ? 'Guest' : 'Account'} style={{ transformOrigin: 'top right' }} {...sheetMotion}>
            {user.isGuest ? <GuestAuth user={user} /> : <MemberAccount user={user} />}
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}

function GuestAuth({ user }: { user: User }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState(user.displayName)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const login = useLogin()
  const register = useRegister()
  const saveName = useSaveName()

  const submit = async () => {
    setError('')
    try {
      if (mode === 'login') await login.mutateAsync({ email, password })
      else await register.mutateAsync({ email, password, displayName: name || undefined })
      useShell.setState({ accountOpen: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to continue')
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="eyebrow">Guest</p>
      <AccountIdentity user={user} onError={setError} />
      <label className="account-field">
        <span>Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="button" className="account-text" onClick={() => void saveName(name).then(setError)}>
        Save name
      </button>
      <div className="account-switch">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>Sign in</button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>Create account</button>
      </div>
      <label className="account-field">
        <span>Email</span>
        <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="account-field">
        <span>Password</span>
        <input className="field" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="account-error" role="alert">{error}</p>}
      <button type="submit" className="account-submit" disabled={!email || !password}>
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  )
}

function MemberAccount({ user }: { user: User }) {
  const [name, setName] = useState(user.displayName)
  const [error, setError] = useState('')
  const logout = useLogout()
  const saveName = useSaveName()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void saveName(name).then(setError)
      }}
    >
      <p className="eyebrow">Account</p>
      <AccountIdentity user={user} onError={setError} />
      <label className="account-field">
        <span>Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <p className="account-error" role="alert">{error}</p>}
      <button type="submit" className="account-submit">Save name</button>
      <button
        type="button"
        className="account-text"
        onClick={() => {
          void logout.mutateAsync().then(() => useShell.setState({ accountOpen: false }))
        }}
      >
        Sign out
      </button>
    </form>
  )
}

function AccountIdentity({ user, onError }: { user: User; onError: (message: string) => void }) {
  return (
    <div className="account-id">
      <AccountAvatar user={user} onError={onError} />
      <div>
        <p className="account-name">{user.displayName}</p>
        {user.email && <p className="account-email">{user.email}</p>}
      </div>
    </div>
  )
}

function useSaveName() {
  const qc = useQueryClient()
  return async (displayName: string) => {
    const name = displayName.trim()
    if (!name) return 'Name is empty'
    const result = await getApiClient().PATCH('/users/me', { body: { displayName: name } })
    if (result.error) {
      const body = result.error as { error?: string }
      return body.error ?? 'Unable to save'
    }
    await qc.invalidateQueries({ queryKey: ['me'] })
    return ''
  }
}
