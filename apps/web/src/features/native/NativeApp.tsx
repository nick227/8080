// /native/ — the mobile dashboard: notifications and workspace awareness across
// every workspace the user belongs to. Work itself happens in the main app.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, useLogout, useMyWorkspaces, useSession, type InboxItem, type User, type Workspace } from '@project/sdk'
import { GuestAuth } from '../AccountSheet'
import { SEO } from '../../components/SEO'
import { destinationOf } from './destination'
import { IosSteps, isStandalone, platform, rememberInstalled, useInstallPrompt } from './install'
import { disablePush, usePush } from './push'
import { KINDS, kindOf, useMarkRead, useUnifiedInbox, type Kind, type WorkspaceInbox } from './inbox'
import './native.css'

/** Where Google sign-in should land again (it always returns to the site root; Home resumes). */
export const RETURN_KEY = '8080.return-to'

export function NativeApp() {
  const session = useSession()
  const user = session.data?.data
  useEffect(() => {
    if (isStandalone()) rememberInstalled()
    // Scope /native/; caches nothing (public/native/sw.js).
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/native/sw.js', { scope: '/native/', updateViaCache: 'none' }).catch(() => { /* the app works without it */ })
    }
  }, [])
  return (
    <div className="native">
      <SEO title="8080" description="Your 8080 notifications and workspaces." />
      <header className="native-head">
        <NavLink to="/native/" className="native-brand" aria-label="8080 inbox">8080</NavLink>
        {user && !user.isGuest && (
          <NavLink to="/native/settings" className="native-me" aria-label="Account and settings">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{user.displayName.trim().slice(0, 1).toUpperCase() || '?'}</span>}
          </NavLink>
        )}
      </header>
      <main className="native-main">
        {session.isError ? (
          <Empty title="Can't reach 8080" body="Check your connection and try again." action={<button type="button" onClick={() => void session.refetch()}>Retry</button>} />
        ) : !user ? (
          <p className="native-quiet" aria-busy>Loading…</p>
        ) : user.isGuest ? (
          <SignIn user={user} />
        ) : (
          <Signed />
        )}
      </main>
      {user && !user.isGuest && (
        <nav className="native-tabs" aria-label="App">
          <NavLink to="/native/" end>Inbox</NavLink>
          <NavLink to="/native/workspaces">Workspaces</NavLink>
          <NavLink to="/native/settings">Settings</NavLink>
        </nav>
      )}
    </div>
  )
}

function SignIn({ user }: { user: User }) {
  return (
    <section className="native-signin">
      <h1>Stay connected to your work</h1>
      <p>Sign in to see notifications from all your workspaces.</p>
      <GuestAuth user={user} onExternalSignIn={() => { try { sessionStorage.setItem(RETURN_KEY, '/native/') } catch { /* lands on Home instead */ } }} />
    </section>
  )
}

function Signed() {
  const workspacesQuery = useMyWorkspaces()
  const workspaces = useMemo(() => workspacesQuery.data ?? [], [workspacesQuery.data])
  const inboxes = useUnifiedInbox(workspaces)
  const queryClient = useQueryClient()

  // An expired session shows up as a 401 anywhere: re-resolve who this is.
  const expired = workspacesQuery.error instanceof ApiError && workspacesQuery.error.status === 401
  useEffect(() => { if (expired) void queryClient.invalidateQueries({ queryKey: ['me'] }) }, [expired, queryClient])

  // A push arrived while the app is open: refresh now rather than on the next poll.
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'push') void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'workspaces' && q.queryKey[2] === 'inbox' })
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [queryClient])

  if (workspacesQuery.isLoading) return <p className="native-quiet" aria-busy>Loading…</p>
  if (workspacesQuery.isError) return <Empty title="Couldn't load your workspaces" body="Check your connection and try again." action={<button type="button" onClick={() => void workspacesQuery.refetch()}>Retry</button>} />
  return (
    <Routes>
      <Route index element={<Inbox inboxes={inboxes} />} />
      <Route path="workspaces" element={<Workspaces inboxes={inboxes} />} />
      <Route path="settings" element={<Settings />} />
      <Route path="*" element={<Inbox inboxes={inboxes} />} />
    </Routes>
  )
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

function Inbox({ inboxes }: { inboxes: WorkspaceInbox[] }) {
  const [params, setParams] = useSearchParams()
  const workspaceId = params.get('w')
  const kind = params.get('type') as Kind | null
  const unreadOnly = params.get('unread') === '1'
  const markRead = useMarkRead()
  const navigate = useNavigate()
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState<string | null>(null)

  const set = (key: string, value: string | null) => {
    // From the live URL: quick successive taps must not undo each other.
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const scoped = inboxes.filter((x) => !workspaceId || x.workspace.id === workspaceId)
  const byId = new Map(inboxes.map((x) => [x.workspace.id, x.workspace]))
  const rows = scoped
    .flatMap((x) => x.items)
    .filter((item) => (!kind || kindOf(item) === kind) && (!unreadOnly || item.unread))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const unreadIds = scoped.flatMap((x) => x.unread.ids.map((id) => ({ workspaceId: x.workspace.id, inboxItemId: id })))
  const moreUnread = scoped.some((x) => x.unread.more)
  const loading = scoped.some((x) => x.loading)
  const gone = inboxes.filter((x) => x.gone)
  const failed = scoped.filter((x) => x.error)
  const selected = workspaceId ? byId.get(workspaceId) : null

  const say = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice((n) => (n === text ? '' : n)), 4000)
  }

  const open = async (item: InboxItem) => {
    if (opening) return
    setOpening(item.id)
    if (item.unread) void markRead([{ workspaceId: item.workspaceId, inboxItemId: item.id }])
    try {
      const to = await destinationOf(item)
      if ('gone' in to) say(to.gone)
      else navigate(to.path)
    } catch {
      say("Couldn't open that. Try again.")
    } finally {
      setOpening(null)
    }
  }

  // A tapped push lands here as ?open=<inbox item id>: open it once the feed has it.
  const openId = params.get('open')
  const handled = useRef<string | null>(null)
  const settled = inboxes.every((x) => !x.loading)
  useEffect(() => {
    if (!openId || handled.current === openId) return
    const target = inboxes.flatMap((x) => x.items).find((item) => item.id === openId)
    if (!target && !settled) return
    handled.current = openId
    const next = new URLSearchParams(window.location.search)
    next.delete('open')
    setParams(next, { replace: true })
    if (target) void open(target)
    else say('That notification is no longer available.')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the feed or the param changes
  }, [openId, inboxes, settled])

  const toggle = (item: InboxItem) => {
    void markRead([{ workspaceId: item.workspaceId, inboxItemId: item.id }], !item.unread).then((ok) => { if (!ok) say("Couldn't save that change.") })
  }

  const markAll = () => {
    void markRead(unreadIds).then((ok) => { if (!ok) say('Some notifications could not be marked read.') })
  }

  if (!inboxes.length) {
    return <Empty title="No workspaces yet" body="Notifications appear here once you join or create a workspace." action={<a href="/workspaces/new">Create a workspace</a>} />
  }

  return (
    <section className="native-inbox" aria-labelledby="native-inbox-title">
      <InstallBanner />
      <div className="native-title-row">
        <h1 id="native-inbox-title">{selected ? selected.name : 'Inbox'}</h1>
        <span className="native-count" aria-live="polite">{unreadIds.length}{moreUnread ? '+' : ''} unread</span>
      </div>

      <div className="native-filters">
        <label className="native-select">
          <span className="sr-only">Workspace</span>
          <select value={workspaceId ?? ''} onChange={(e) => set('w', e.target.value || null)}>
            <option value="">All workspaces</option>
            {inboxes.map((x) => <option key={x.workspace.id} value={x.workspace.id}>{x.workspace.name}</option>)}
          </select>
        </label>
        <button type="button" className="native-chip" aria-pressed={unreadOnly} onClick={() => set('unread', unreadOnly ? null : '1')}>Unread</button>
        {unreadIds.length > 0 && <button type="button" className="native-link" onClick={markAll}>Mark all read</button>}
      </div>
      <div className="native-chips" role="group" aria-label="Notification type">
        <button type="button" className="native-chip" aria-pressed={!kind} onClick={() => set('type', null)}>All</button>
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="native-chip" aria-pressed={kind === k.id} onClick={() => set('type', kind === k.id ? null : k.id)}>{k.label}</button>
        ))}
      </div>

      {gone.map((x) => <p key={x.workspace.id} className="native-banner">You no longer have access to {x.workspace.name}.</p>)}
      {failed.length > 0 && <p className="native-banner">Couldn't refresh {failed.map((x) => x.workspace.name).join(', ')}. Retrying.</p>}

      {loading && rows.length === 0 ? (
        <p className="native-quiet" aria-busy>Loading…</p>
      ) : rows.length === 0 ? (
        <Empty
          title={unreadOnly || kind ? 'Nothing matches' : "You're all caught up"}
          body={unreadOnly || kind ? 'Try a different filter.' : 'Mentions, assignments, blocked tasks and conversation activity show up here.'}
        />
      ) : (
        <ul className="native-list">
          {rows.map((item) => (
            <li key={item.id}>
              <Notice
                item={item}
                workspace={byId.get(item.workspaceId)}
                busy={opening === item.id}
                onOpen={() => void open(item)}
                onToggle={() => toggle(item)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="native-toast" role="status" aria-live="polite">{notice}</div>
    </section>
  )
}

function Notice({ item, workspace, busy, onOpen, onToggle }: { item: InboxItem; workspace?: Workspace; busy: boolean; onOpen: () => void; onToggle: () => void }) {
  const label = KINDS.find((k) => k.id === kindOf(item))?.label
  return (
    <article className="native-card" data-unread={item.unread || undefined} aria-busy={busy || undefined}>
      <button type="button" className="native-card-open" onClick={onOpen}>
        <span className="native-card-meta">
          <WorkspaceMark name={workspace?.name ?? '?'} />
          <span className="native-card-ws">{workspace?.name ?? 'Workspace'}</span>
          <span aria-hidden>·</span>
          <span>{label}</span>
          <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{ago(item.createdAt)}</time>
        </span>
        <span className="native-card-title">{item.unread && <span className="sr-only">Unread: </span>}{item.title}</span>
        {item.summary && item.summary !== item.title && <span className="native-card-summary">{item.summary}</span>}
      </button>
      <button type="button" className="native-card-dot" aria-label={item.unread ? 'Mark read' : 'Mark unread'} title={item.unread ? 'Mark read' : 'Mark unread'} onClick={onToggle}>
        <span aria-hidden />
      </button>
    </article>
  )
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

function Workspaces({ inboxes }: { inboxes: WorkspaceInbox[] }) {
  if (!inboxes.length) {
    return <Empty title="No workspaces yet" body="Create a workspace, or ask a teammate to invite you." action={<a href="/workspaces/new">Create a workspace</a>} />
  }
  return (
    <section aria-labelledby="native-ws-title">
      <div className="native-title-row"><h1 id="native-ws-title">Workspaces</h1></div>
      <ul className="native-list">
        {inboxes.map(({ workspace, unread, gone }) => (
          <li key={workspace.id}>
            <NavLink to={`/native/?w=${encodeURIComponent(workspace.id)}`} className="native-ws" data-gone={gone || undefined}>
              <WorkspaceMark name={workspace.name} large />
              <span className="native-ws-name">
                <strong>{workspace.name}</strong>
                <span>{gone ? 'No longer available' : workspace.role === 'owner' ? 'Owner' : workspace.role === 'admin' ? 'Admin' : 'Member'}</span>
              </span>
              {unread.ids.length > 0 && <span className="native-badge" aria-label={`${unread.ids.length}${unread.more ? '+' : ''} unread`}>{unread.ids.length}{unread.more ? '+' : ''}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Settings ────────────────────────────────────────────────────────────────

function Settings() {
  const session = useSession()
  const user = session.data?.data
  const logout = useLogout()
  if (!user) return null
  return (
    <section className="native-settings" aria-labelledby="native-settings-title">
      <div className="native-title-row"><h1 id="native-settings-title">Settings</h1></div>
      <div className="native-account">
        <span className="native-me native-me-lg">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{user.displayName.trim().slice(0, 1).toUpperCase() || '?'}</span>}</span>
        <span>
          <strong>{user.displayName}</strong>
          {user.email && <span>{user.email}</span>}
        </span>
      </div>
      <div className="native-group">
        <h2>Notifications</h2>
        <PushSection />
      </div>
      <div className="native-group">
        <h2>App</h2>
        <InstallSection />
      </div>
      <div className="native-group">
        <h2>Account</h2>
        <a href="/account">Account settings</a>
        <a href="/">Open 8080 on the web</a>
      </div>
      <button
        type="button"
        className="native-signout"
        disabled={logout.isPending}
        // This device stops receiving the account's notifications first.
        onClick={() => void disablePush().finally(() => logout.mutate(undefined, { onSettled: () => window.location.assign('/native/') }))}
      >
        {logout.isPending ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  )
}

// ─── push ────────────────────────────────────────────────────────────────────

function PushSection() {
  const push = usePush()
  if (push.support === 'needs-install') return <p>On iPhone and iPad, notifications work once 8080 is on your Home Screen (iOS 16.4 or later). Add it below, then open it from the Home Screen.</p>
  if (push.support === 'unsupported') return <p>This browser can’t receive push notifications. Your inbox still updates whenever the app is open.</p>
  const on = push.subscribed === true
  return (
    <>
      <div className="native-row">
        <span>
          <strong>This device</strong>
          <span className="native-status" data-on={on || undefined}>
            {push.subscribed === null ? 'Checking…' : on ? 'Receiving notifications' : push.permission === 'denied' ? 'Blocked in browser settings' : 'Off'}
          </span>
        </span>
        <button type="button" className="native-switch" role="switch" aria-checked={on} aria-label="Push notifications on this device" disabled={push.busy || push.subscribed === null} onClick={() => void (on ? push.disable() : push.enable())}>
          <span aria-hidden />
        </button>
      </div>
      <p>Mentions, assignments, blocked tasks, due dates and conversation activity from all your workspaces.</p>
      {on && <button type="button" className="native-button" disabled={push.busy} onClick={() => void push.test()}>Send a test notification</button>}
      <p role="status" aria-live="polite">{push.message}</p>
    </>
  )
}

// ─── install ─────────────────────────────────────────────────────────────────

const DISMISS_KEY = '8080.install-dismissed'

/** A compact, dismissible offer at the top of the inbox; never shown once installed. */
function InstallBanner() {
  const [params] = useSearchParams()
  const asked = params.get('install') === '1'
  const { canPrompt, install, installed } = useInstallPrompt()
  const ios = platform() === 'ios'
  const [open, setOpen] = useState(asked)
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false } })
  if (isStandalone() || installed || (dismissed && !asked) || !(canPrompt || ios)) return null
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* session-only */ }
    setDismissed(true)
    setOpen(false)
  }
  return (
    <aside className="native-install" aria-label="Install the app">
      <img src="/native/icon-192.png" alt="" width={40} height={40} />
      <div className="native-install-copy">
        <strong>Add 8080 to your home screen</strong>
        <span>Open your notifications in one tap.</span>
        {open && ios && <IosSteps />}
      </div>
      <div className="native-install-actions">
        {canPrompt ? <button type="button" className="native-button" data-primary onClick={() => void install()}>Install</button>
          : !open && <button type="button" className="native-button" data-primary onClick={() => setOpen(true)}>How</button>}
        <button type="button" className="native-install-close" aria-label="Not now" onClick={dismiss}>×</button>
      </div>
    </aside>
  )
}

function InstallSection() {
  const { canPrompt, install, installed } = useInstallPrompt()
  if (isStandalone()) return <p>You’re using the installed app.</p>
  if (installed) return <p>Installed. Open 8080 from your home screen or app list.</p>
  if (canPrompt) {
    return (
      <>
        <p>Install 8080 to open your notifications from your home screen.</p>
        <button type="button" className="native-button" data-primary onClick={() => void install()}>Install app</button>
      </>
    )
  }
  if (platform() === 'ios') return <IosSteps />
  if (platform() === 'android') return <p>Open this page in Chrome, then choose Install app (or Add to Home screen) from the ⋮ menu.</p>
  return <p>On your phone, open {window.location.host}/native/ in Safari (iPhone) or Chrome (Android) to add 8080 to your home screen. It also works here in the browser.</p>
}

// ─── bits ────────────────────────────────────────────────────────────────────

function WorkspaceMark({ name, large = false }: { name: string; large?: boolean }) {
  return <span className="native-mark" data-large={large || undefined} aria-hidden>{name.trim().slice(0, 1).toUpperCase() || '?'}</span>
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="native-empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  )
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
