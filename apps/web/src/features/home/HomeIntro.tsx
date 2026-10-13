// Homepage introduction: who 8080 is and what it includes, with the signup form beside it.
// Every claim names something that ships; anything not open yet says so.
// Premium checkout is not open yet (server `checkout.enabled: false`) and Live is paused, so both
// plans create the same account; choosing Premium says so plainly instead of taking payment details.
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, getApiClient, useMyEntitlements, useRegister, useSession } from '@project/sdk'
import { useShell } from '../../state/shell'
import './home-intro.css'

type Plan = 'free' | 'premium'

const INCLUDED = [
  'Contacts, companies and notes',
  'Tasks on calendar, board and table',
  'Live documents and spreadsheets',
  'Daily email briefs to your team',
  'Inbox and phone notifications',
  'AI agents that send updates',
  'Gmail, Microsoft 365 and YouTube',
  'Real-time video conferencing',
]

const PLANS: Record<Plan, { name: string; price: string; tag?: string; note: string }> = {
  premium: { name: 'Premium', price: 'Price at launch', tag: 'For teams', note: 'Invites emailed for you. Live video when it opens.' },
  free: { name: 'Free', price: '$0', note: 'The full workspace. Share invite links yourself.' },
}

export function HomeIntro() {
  const session = useSession()
  const user = session.data?.data
  const registered = user ? !user.isGuest : false
  const [plan, setPlan] = useState<Plan>('premium')

  return (
    <section id="intro" className="home-section home-intro" aria-labelledby="heading-intro">
      <div className="home-intro-hero">
        <div className="home-intro-copy">
          <p className="home-intro-pill"><span>8080</span> CRM and work management</p>
          <h1 id="heading-intro">Run your company from <mark>one workspace</mark>.</h1>
          <p className="home-intro-lead">
            Customers, tasks, documents and team conversations in one place. Email agents send your team a
            daily brief from your own Gmail, Microsoft 365 or domain. Mentions, assignments and deadlines
            reach you in one inbox and on your phone. The assistant turns notes into CRM updates you approve,
            and blueprints give you a working plan to start from.
          </p>
          <ul className="home-intro-list">
            {INCLUDED.map((item) => <li key={item}><Check />{item}</li>)}
          </ul>
          <Link className="home-intro-more" to="/blueprints">Browse blueprints <span aria-hidden>→</span></Link>
        </div>
        <div className="home-intro-card">
          <img style={{ maxWidth: "365px" }} src="stock/dezgo_1b167e4045e06c30.webp" />
          {registered && user ? <SignedIn name={user.displayName} /> : <Signup plan={plan} setPlan={setPlan} />}
        </div>
      </div>
    </section>
  )
}

function Signup({ plan, setPlan }: { plan: Plan; setPlan: (plan: Plan) => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const register = useRegister()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      await register.mutateAsync({ email, password, displayName: name.trim() || undefined })
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      navigate('/workspaces/new')
    } catch (e) {
      setError(signupError(e))
    }
  }

  const google = async () => {
    setError('')
    try {
      const res = await getApiClient().GET('/auth/google/url', {})
      const url = res.data?.data?.url
      if (!url) return setError('Google sign-in is not available right now.')
      // Home resumes workspace creation when Google returns (see views/Home.tsx).
      try { sessionStorage.setItem('8080.create-workspace', '1') } catch { /* creation can still start by hand */ }
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Google sign-in.')
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby="home-intro-signup">
      <h2 id="home-intro-signup">Create your account</h2>
      <p className="home-intro-card-sub">Pick a plan. You can change it later.</p>

      <fieldset className="home-intro-plans">
        <legend className="sr-only">Plan</legend>
        {(Object.keys(PLANS) as Plan[]).map((key) => (
          <label key={key} className="home-intro-plan" data-plan={key} data-selected={plan === key || undefined}>
            <input type="radio" name="plan" value={key} checked={plan === key} onChange={() => setPlan(key)} />
            {PLANS[key].tag && <span className="home-intro-tag">{PLANS[key].tag}</span>}
            <span className="home-intro-plan-head">
              <strong>{PLANS[key].name}</strong>
              <span className="home-intro-price">{PLANS[key].price}</span>
            </span>
            <span className="home-intro-plan-note">{PLANS[key].note}</span>
          </label>
        ))}
      </fieldset>

      <label className="home-intro-field">
        <span>Name</span>
        <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
      </label>
      <label className="home-intro-field">
        <span>Work email</span>
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="home-intro-field">
        <span>Password</span>
        <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <small>At least 8 characters.</small>
      </label>

      {plan === 'premium' && (
        <p className="home-intro-notice" role="status">
          Checkout isn’t open yet. You start on Free; your workspaces carry over.
        </p>
      )}
      {error && <p className="home-intro-error" role="alert">{error}</p>}

      <button type="submit" className="home-intro-submit" disabled={register.isPending}>
        {register.isPending ? 'Creating account…' : plan === 'premium' ? 'Create account' : 'Start free'}
      </button>
      <button type="button" className="home-intro-google" onClick={() => void google()}>Continue with Google</button>
      <p className="home-intro-signin">
        Already have an account?{' '}
        <button type="button" onClick={() => useShell.setState({ accountOpen: true })}>Sign in</button>
      </p>
    </form>
  )
}

function signupError(e: unknown) {
  if (e instanceof ApiError && e.status === 409) return 'That email already has an account. Sign in instead.'
  if (e instanceof ApiError && e.status === 400) return 'Check your email address and use a password of at least 8 characters.'
  return e instanceof Error ? e.message : 'Could not create your account. Try again.'
}

function SignedIn({ name }: { name: string }) {
  const access = useMyEntitlements(true)
  const tier = access.data?.tier
  return (
    <div aria-labelledby="home-intro-signed-in">
      <h2 id="home-intro-signed-in">Welcome back{name ? `, ${name}` : ''}</h2>
      <p className="home-intro-card-sub">
        {tier === 'premium' ? 'You’re on Premium.' : tier === 'free' ? 'You’re on Free. Premium checkout opens soon.' : ' '}
      </p>
      <Link className="home-intro-submit" to="/workspaces/new">Create a workspace</Link>
      <a className="home-intro-google" href="#workspaces">Open your workspaces</a>
    </div>
  )
}

function Check() {
  return (
    <svg className="home-intro-check" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="10" />
      <path d="M5.5 10.3l3 3 6-6.6" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
