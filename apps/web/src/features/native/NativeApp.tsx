// /native/ — the mobile app: what needs you, across every workspace and conversation.
// Work itself happens in the main app. Built from the primitives in ./ui.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, getApiBaseUrl, useLogout, useMyWorkspaces, useSession, type User } from '@project/sdk'
import { GuestAuth } from '../AccountSheet'
import { SEO } from '../../components/SEO'
import { destinationOf } from './destination'
import { IosSteps, isStandalone, platform, rememberInstalled, useInstallPrompt } from './install'
import { disablePush, usePush } from './push'
import { ROOMS, isFeedKey, useMarkRead, useUnifiedInbox, type Feed, type Kind, type Mark, type Notice } from './inbox'
import { AssignIcon, AtIcon, BellIcon, BlockedIcon, ChatIcon, CheckAllIcon, ClockIcon, GearIcon, GridIcon, HashIcon, InboxIcon, PhoneIcon, PulseIcon, ReplyIcon } from './icons'
import { Avatar, Badge, Banner, Button, Chip, Empty, Glyph, IconButton, Row, Screen, Section, Segmented, SkeletonRows, SnackbarHost, Switch, useSnackbar } from './ui'
import './native.css'

/** Where Google sign-in should land again (it always returns to the site root; Home resumes). */
export const RETURN_KEY = '8080.return-to'

/** Addressed to you: what For you shows, and what can reach the phone. */
const FOR_YOU = new Set<Kind>(['mention', 'reply', 'assigned', 'blocked', 'due'])

export function NativeApp() {
  const session = useSession()
  const user = session.data?.data
  useEffect(() => {
    if (isStandalone()) rememberInstalled()
    // Scope /native/; caches nothing (public/native/sw.js).
    if ('serviceWorker' in navigator && window.isSecureContext) {
      // The worker reports deliveries (displayed, opened) to the API this page uses.
      navigator.serviceWorker.register(`/native/sw.js?api=${encodeURIComponent(getApiBaseUrl())}`, { scope: '/native/', updateViaCache: 'none' }).catch(() => { /* the app works without it */ })
    }
  }, [])
  return (
    <div className="native">
      <SEO title="8080" description="Your 8080 notifications and workspaces." />
      <SnackbarHost>
        {session.isError ? (
          <Empty title="Can’t reach 8080" action={<Button variant="filled" onClick={() => void session.refetch()}>Try again</Button>}>Check your connection.</Empty>
        ) : !user ? (
          <SkeletonRows />
        ) : user.isGuest ? (
          <SignIn user={user} />
        ) : (
          <Signed />
        )}
      </SnackbarHost>
    </div>
  )
}

function SignIn({ user }: { user: User }) {
  return (
    <section className="n-signin">
      <img src="/native/icon-192.png" alt="" width={56} height={56} />
      <h1>Stay connected to your work</h1>
      <p>Sign in to get mentions, replies and tasks from all your workspaces.</p>
      <GuestAuth user={user} onExternalSignIn={() => { try { sessionStorage.setItem(RETURN_KEY, '/native/') } catch { /* lands on Home instead */ } }} />
    </section>
  )
}

function Signed() {
  const workspacesQuery = useMyWorkspaces()
  const workspaces = useMemo(() => workspacesQuery.data ?? [], [workspacesQuery.data])
  const feeds = useUnifiedInbox(workspaces)
  const queryClient = useQueryClient()

  // An expired session shows up as a 401 anywhere: re-resolve who this is.
  const expired = workspacesQuery.error instanceof ApiError && workspacesQuery.error.status === 401
  useEffect(() => { if (expired) void queryClient.invalidateQueries({ queryKey: ['me'] }) }, [expired, queryClient])

  // A push arrived while the app is open: refresh now rather than on the next poll.
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'push') void queryClient.invalidateQueries({ predicate: (q) => isFeedKey(q.queryKey) })
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [queryClient])

  const needsYou = feeds.flatMap((f) => f.notices).filter((n) => n.unread && FOR_YOU.has(n.kind)).length

  return (
    <>
      <main className="n-main">
        {workspacesQuery.isLoading ? <SkeletonRows /> : workspacesQuery.isError ? (
          <Empty title="Couldn’t load your workspaces" action={<Button variant="filled" onClick={() => void workspacesQuery.refetch()}>Try again</Button>}>Check your connection.</Empty>
        ) : (
          <Routes>
            <Route index element={<Inbox feeds={feeds} />} />
            <Route path="workspaces" element={<Workspaces feeds={feeds} />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Inbox feeds={feeds} />} />
          </Routes>
        )}
      </main>
      <nav className="n-tabs" aria-label="App">
        <Tab to="/native/" end icon={<InboxIcon />} label="Inbox" badge={needsYou} />
        <Tab to="/native/workspaces" icon={<GridIcon />} label="Workspaces" />
        <Tab to="/native/settings" icon={<GearIcon />} label="Settings" />
      </nav>
    </>
  )
}

function Tab({ to, end, icon, label, badge = 0 }: { to: string; end?: boolean; icon: ReactNode; label: string; badge?: number }) {
  return (
    <NavLink to={to} end={end} className="n-tab" aria-label={badge ? `${label}, ${badge} need you` : label}>
      <span className="n-tab-pill">{icon}{badge > 0 && <span className="n-tab-badge" aria-hidden>{badge > 99 ? '99+' : badge}</span>}</span>
      <span className="n-tab-label">{label}</span>
    </NavLink>
  )
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

type View = 'for-you' | 'all'

// Tiles stay neutral; only work that is stuck or late keeps a warm tint while unread.
// Unread itself is the dot and the weight of the line, nothing else.
const GLYPH: Record<Kind, { icon: ReactNode; tone: 'warn' | 'quiet'; label: string }> = {
  mention: { icon: <AtIcon />, tone: 'quiet', label: 'Mention' },
  reply: { icon: <ReplyIcon />, tone: 'quiet', label: 'Reply' },
  assigned: { icon: <AssignIcon />, tone: 'quiet', label: 'Assigned to you' },
  blocked: { icon: <BlockedIcon />, tone: 'warn', label: 'Blocked' },
  due: { icon: <ClockIcon />, tone: 'warn', label: 'Due' },
  message: { icon: <ChatIcon />, tone: 'quiet', label: 'Message' },
  activity: { icon: <PulseIcon />, tone: 'quiet', label: 'Activity' },
}

function Inbox({ feeds }: { feeds: Feed[] }) {
  const [params, setParams] = useSearchParams()
  const scope = params.get('w')
  const view: View = params.get('view') === 'all' ? 'all' : 'for-you'
  const markRead = useMarkRead()
  const navigate = useNavigate()
  const say = useSnackbar()
  const [opening, setOpening] = useState<string | null>(null)

  const set = (key: string, value: string | null) => {
    // From the live URL: quick successive taps must not undo each other.
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const scoped = feeds.filter((f) => !scope || f.key === scope)
  const inScope = scoped.flatMap((f) => f.notices)
  const rows = inScope
    .filter((n) => view === 'all' || FOR_YOU.has(n.kind))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const fresh = rows.filter((n) => n.unread)
  const earlier = rows.filter((n) => !n.unread)
  const forYouCount = inScope.filter((n) => n.unread && FOR_YOU.has(n.kind)).length
  // "Mark all read" covers what this view shows (For you), or everything unread (All).
  const unreadMarks: Mark[] = view === 'all'
    ? scoped.flatMap((f) => f.unread.ids.map((id) => ({ workspaceId: f.workspace?.id ?? null, id })))
    : fresh.map((n) => ({ workspaceId: n.workspaceId, id: n.id }))
  const loading = scoped.some((f) => f.loading)
  const gone = feeds.filter((f) => f.gone && f.workspace)
  const failed = scoped.filter((f) => f.error)
  const selected = scope ? feeds.find((f) => f.key === scope) : null

  const open = async (notice: Notice) => {
    if (opening) return
    setOpening(notice.id)
    if (notice.unread) void markRead([notice])
    try {
      const to = await destinationOf(notice)
      if ('gone' in to) say(to.gone)
      else navigate(to.path)
    } catch {
      say('Couldn’t open that. Try again.')
    } finally {
      setOpening(null)
    }
  }

  // A tapped push lands here as ?open=<inbox item id>: open it once the feed has it.
  const openId = params.get('open')
  const handled = useRef<string | null>(null)
  const settled = feeds.every((f) => !f.loading)
  useEffect(() => {
    if (!openId || handled.current === openId) return
    const target = feeds.flatMap((f) => f.notices).find((n) => n.id === openId)
    if (!target && !settled) return
    handled.current = openId
    const next = new URLSearchParams(window.location.search)
    next.delete('open')
    setParams(next, { replace: true })
    if (target) void open(target)
    else say('That notification is no longer available.')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the feed or the param changes
  }, [openId, feeds, settled])

  const markAll = () => {
    void markRead(unreadMarks).then((ok) => say(ok ? 'Marked as read' : 'Some notifications couldn’t be marked read'))
  }

  const row = (n: Notice) => <NoticeRow key={n.id} notice={n} busy={opening === n.id} onOpen={() => void open(n)} />

  return (
    <Screen
      title="Inbox"
      actions={unreadMarks.length > 0 && <IconButton label="Mark all as read" onClick={markAll}><CheckAllIcon /></IconButton>}
    >
      <EnablePush />
      <InstallBanner />
      <div className="n-inbox-controls">
        <Segmented<View>
          label="Show"
          value={view}
          onChange={(v) => set('view', v === 'all' ? 'all' : null)}
          options={[{ id: 'for-you', label: 'For you', count: forYouCount }, { id: 'all', label: 'All' }]}
        />
        {selected && <Chip onClear={() => set('w', null)} clearLabel={`Show all workspaces`}>{selected.label}</Chip>}
      </div>

      {gone.map((f) => <Banner key={f.key} title={`You no longer have access to ${f.label}`} />)}
      {failed.length > 0 && <Banner title="Couldn’t refresh">{failed.map((f) => f.label).join(', ')}. Retrying.</Banner>}

      {loading && rows.length === 0 ? <SkeletonRows /> : rows.length === 0 ? (
        view === 'for-you' ? (
          <Empty icon={<BellIcon />} title="Nothing needs you" action={inScope.length > 0 && <Button variant="text" onClick={() => set('view', 'all')}>See all activity</Button>}>
            Mentions, replies, tasks assigned to you and blocked work land here.
          </Empty>
        ) : (
          <Empty icon={<InboxIcon />} title="No notifications yet">Activity from your workspaces and conversations shows up here.</Empty>
        )
      ) : (
        <div className="n-notices">
          {fresh.length > 0 && <Section title="New">{fresh.map(row)}</Section>}
          {earlier.length > 0 && <Section title={fresh.length > 0 ? 'Earlier' : undefined}>{earlier.map(row)}</Section>}
        </div>
      )}
    </Screen>
  )
}

/** One notice: what it is (glyph), who did what, the words, where, when. */
function NoticeRow({ notice, busy, onOpen }: { notice: Notice; busy: boolean; onOpen: () => void }) {
  const glyph = GLYPH[notice.kind]
  const room = notice.workspaceId === null
  return (
    <Row
      leading={<Glyph tone={notice.unread ? glyph.tone : 'quiet'}>{glyph.icon}</Glyph>}
      title={keepKeys(notice.title)}
      subtitle={notice.summary && notice.summary !== notice.title ? notice.summary : undefined}
      meta={<>{room ? <HashIcon className="n-meta-icon" /> : null}<span>{notice.place || 'Conversation'}</span></>}
      aside={<time dateTime={notice.createdAt} title={new Date(notice.createdAt).toLocaleString()}>{ago(notice.createdAt)}</time>}
      unread={notice.unread}
      busy={busy}
      onClick={onOpen}
      label={`${notice.unread ? 'Unread. ' : ''}${glyph.label}. ${notice.title}. ${notice.summary}. ${notice.place}. ${ago(notice.createdAt, true)}`}
    />
  )
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

function Workspaces({ feeds }: { feeds: Feed[] }) {
  const rooms = feeds.find((f) => f.key === ROOMS)
  const spaces = feeds.filter((f) => f.workspace)
  const role = (r: string) => (r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : 'Member')
  return (
    <Screen title="Workspaces">
      {rooms && (
        <Section>
          <Row
            to={`/native/?view=all&w=${ROOMS}`}
            leading={<Glyph size="lg"><HashIcon /></Glyph>}
            title="Conversations"
            subtitle="Mentions, replies and messages"
            trailing={<Badge count={rooms.unread.ids.length} more={rooms.unread.more} />}
            chevron
          />
        </Section>
      )}
      {spaces.length > 0 ? (
        <Section title="Your workspaces">
          {spaces.map(({ key, label, workspace, unread, gone }) => (
            <Row
              key={key}
              to={`/native/?view=all&w=${encodeURIComponent(key)}`}
              leading={<Glyph size="lg"><span className="n-initial">{label.trim().slice(0, 1).toUpperCase() || '?'}</span></Glyph>}
              title={label}
              subtitle={gone ? 'No longer available' : role(workspace!.role)}
              trailing={<Badge count={unread.ids.length} more={unread.more} />}
              chevron
            />
          ))}
        </Section>
      ) : (
        <Empty icon={<GridIcon />} title="No workspaces yet" action={<Button variant="filled" onClick={() => window.location.assign('/workspaces/new')}>Create a workspace</Button>}>
          Create one, or ask a teammate to invite you.
        </Empty>
      )}
    </Screen>
  )
}

// ─── Settings ────────────────────────────────────────────────────────────────

function Settings() {
  const session = useSession()
  const user = session.data?.data
  const logout = useLogout()
  if (!user) return null
  return (
    <Screen title="Settings">
      <Section>
        <Row leading={<Avatar name={user.displayName} src={user.avatarUrl} size={48} />} title={user.displayName} subtitle={user.email ?? undefined} />
      </Section>
      <PushSection />
      <InstallSection />
      <Section title="Account">
        <Row href="/account" title="Account settings" chevron />
        <Row href="/" title="Open 8080 on the web" chevron />
        <Row
          title={logout.isPending ? 'Signing out…' : 'Sign out'}
          danger
          busy={logout.isPending}
          // This device stops receiving the account's notifications first.
          onClick={() => void disablePush().finally(() => logout.mutate(undefined, { onSettled: () => window.location.assign('/native/') }))}
        />
      </Section>
    </Screen>
  )
}

function PushSection() {
  const push = usePush()
  if (push.support === 'needs-install') {
    return <Section title="Notifications"><Row title="Add 8080 to your Home Screen first" subtitle="iPhone and iPad send notifications only to apps on the Home Screen (iOS 16.4 or later)." /></Section>
  }
  if (push.support === 'unsupported') {
    return <Section title="Notifications"><Row title="Not available in this browser" subtitle="Your inbox still updates whenever the app is open." /></Section>
  }
  const on = push.subscribed === true
  const status = push.subscribed === null ? 'Checking…' : on ? 'On' : push.permission === 'denied' ? 'Blocked in your browser’s site settings' : 'Off'
  return (
    <Section title="Notifications" footer={push.message || 'Mentions, replies, tasks assigned to you and blocked work. Everything else waits in your inbox.'}>
      <Row
        title="Notifications on this device"
        subtitle={status}
        trailing={<Switch checked={on} label="Notifications on this device" disabled={push.busy || push.subscribed === null} onClick={() => void (on ? push.disable() : push.enable())} />}
      />
      {on && <Row title="Send a test notification" onClick={() => { if (!push.busy) void push.test() }} busy={push.busy} />}
    </Section>
  )
}

function InstallSection() {
  const { canPrompt, install, installed } = useInstallPrompt()
  if (isStandalone()) return null
  return (
    <Section title="App" footer={!installed && !canPrompt && platform() === 'desktop' ? `On your phone, open ${window.location.host}/native/ to add 8080 to your home screen.` : undefined}>
      {installed ? <Row leading={<Glyph><PhoneIcon /></Glyph>} title="Installed" subtitle="Open 8080 from your home screen" />
        : canPrompt ? <Row leading={<Glyph><PhoneIcon /></Glyph>} title="Install app" subtitle="Open your notifications in one tap" onClick={() => void install()} chevron />
          : platform() === 'ios' ? <Row leading={<Glyph><PhoneIcon /></Glyph>} title="Add to Home Screen" subtitle={<IosSteps />} />
            : platform() === 'android' ? <Row leading={<Glyph><PhoneIcon /></Glyph>} title="Install app" subtitle="In Chrome, open the ⋮ menu and choose Install app" />
              : <Row leading={<Glyph><PhoneIcon /></Glyph>} title="Use 8080 on your phone" subtitle="It also works here in the browser" />}
    </Section>
  )
}

// ─── asks at the top of the inbox ────────────────────────────────────────────

const PROMPT_KEY = '8080.push-prompt-dismissed'

/** The app's one ask: shown first thing in the installed app (and in browsers that can
 *  push) until this device gets notifications or the person says not now. The browser's
 *  permission prompt only ever follows a tap here. */
function EnablePush() {
  const push = usePush()
  const { canPrompt } = useInstallPrompt()
  const say = useSnackbar()
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(PROMPT_KEY) === '1' } catch { return false } })
  const installed = isStandalone()
  // iOS can't push from Safari (the install banner covers it); an installable browser installs first.
  if (push.support !== 'ok' || push.subscribed !== false || push.permission === 'denied' || dismissed) return null
  if (!installed && canPrompt) return null
  const dismiss = () => {
    try { localStorage.setItem(PROMPT_KEY, '1') } catch { /* this session only */ }
    setDismissed(true)
  }
  return (
    <Banner
      icon={<BellIcon />}
      title="Turn on notifications"
      actions={<>
        <Button variant="filled" disabled={push.busy} onClick={() => void push.enable().then((ok) => { if (ok) say('Notifications are on') })}>{push.busy ? 'Turning on…' : 'Turn on'}</Button>
        <Button variant="text" onClick={dismiss}>Not now</Button>
      </>}
    >
      {push.message || 'Only when someone mentions you, replies to you, assigns you a task or blocks your work.'}
    </Banner>
  )
}

const DISMISS_KEY = '8080.install-dismissed'

/** A compact, dismissible offer to install; never shown once installed. */
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
    <Banner
      icon={<img src="/native/icon-192.png" alt="" width={36} height={36} />}
      title="Add 8080 to your home screen"
      onDismiss={dismiss}
      actions={canPrompt ? <Button variant="filled" onClick={() => void install()}>Install</Button> : !open ? <Button variant="tonal" onClick={() => setOpen(true)}>Show me how</Button> : undefined}
    >
      {open && ios ? <IosSteps /> : 'Open your notifications in one tap.'}
    </Banner>
  )
}

// ─── bits ────────────────────────────────────────────────────────────────────

/** Task keys (VC-102) never break across lines. */
const keepKeys = (text: string) => text.replace(/\b([A-Z][A-Z0-9]*)-(\d+)\b/g, '$1\u2011$2')

function ago(iso: string, spoken = false) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return spoken ? `${Math.floor(s / 60)} minutes ago` : `${Math.floor(s / 60)}m`
  if (s < 86400) return spoken ? `${Math.floor(s / 3600)} hours ago` : `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return spoken ? `${Math.floor(s / 86400)} days ago` : `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
