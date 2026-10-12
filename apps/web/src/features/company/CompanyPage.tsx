import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  useBudgetSummary,
  useTaskReport,
  useUpdateWorkspace,
  useUploadMedia,
  useWorkspaceInsights,
  useWorkspaceInvites,
  useWorkspaceMembers,
} from '@project/sdk'
import { formatMinorMoney } from '@project/shared'
import { BellIcon, BookIcon, BuildingIcon, ChartMetricsIcon, ClockIcon, GridViewIcon, PersonIcon, SendIcon, UserCardIcon, WorkflowIcon } from '../../components/icons'
import { FormSlideout } from '../work/FormSlideout'
import { InviteMember } from '../team/InviteMember'
import { formatAgo } from '../../utils/time'
import { InlineList, InlineSelect, InlineText } from './Inline'
import { useCompanyProfile, type CompanyProfile, type ListField, type ProfileChanges } from './useCompanyProfile'
import type { DeskLink } from './links'
import './company-page.css'

type Workspace = { id: string; name: string; role: string; createdAt: string }
type Option = { value: string; label: string }

const options = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))
const ENTITY = options([['sole_proprietorship', 'Sole proprietorship'], ['partnership', 'Partnership'], ['llc', 'LLC'], ['corporation', 'Corporation'], ['s_corporation', 'S corporation'], ['nonprofit', 'Nonprofit'], ['cooperative', 'Cooperative'], ['other', 'Other entity']])
const EMPLOYEES = options([['1', '1 employee'], ['2-10', '2–10 employees'], ['11-50', '11–50 employees'], ['51-200', '51–200 employees'], ['201-1000', '201–1,000 employees'], ['1000+', '1,000+ employees']])
const REVENUE = options([['under_100k', 'Under $100K revenue'], ['100k_500k', '$100K–$500K revenue'], ['500k_1m', '$500K–$1M revenue'], ['1m_5m', '$1M–$5M revenue'], ['5m_20m', '$5M–$20M revenue'], ['20m_100m', '$20M–$100M revenue'], ['100m_plus', '$100M+ revenue']])
const MODEL = options([['b2b', 'B2B'], ['b2c', 'B2C'], ['b2b2c', 'B2B2C'], ['b2g', 'B2G'], ['d2c', 'Direct to consumer'], ['marketplace', 'Marketplace']])
const PRICING = options([['fixed', 'Fixed price'], ['hourly', 'Hourly'], ['retainer', 'Retainer'], ['subscription', 'Subscription'], ['usage', 'Usage-based'], ['commission', 'Commission'], ['mixed', 'Mixed']])
const REACH = options([['local', 'Local'], ['regional', 'Regional'], ['national', 'National'], ['global', 'Global']])
const VOICE = options([['professional', 'Professional'], ['friendly', 'Friendly'], ['bold', 'Bold'], ['technical', 'Technical']])

const URL_HINT = 'Use a full address starting with https://'
const webUrl = (v: string) => {
  try {
    const url = new URL(v)
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? null : URL_HINT
  } catch {
    return URL_HINT
  }
}
const host = (v: string) => {
  try {
    return new URL(v).hostname.replace(/^www\./, '')
  } catch {
    return v
  }
}
const year = (v: string) => (/^\d{4}$/.test(v) && Number(v) >= 1800 && Number(v) <= new Date().getFullYear() ? null : `A year between 1800 and ${new Date().getFullYear()}`)
const email = (v: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Use an email address, e.g. hello@company.com')
const phone = (v: string) => (/^\+?[\d\s().-]{5,40}$/.test(v) ? null : 'Use digits, spaces and + ( ) - .')

type FieldDef = { key: string; label: string; filled: boolean; node: ReactNode }
type SectionDef = { id: string; title: string; blurb: string; icon: ReactNode; fields: FieldDef[] }

/**
 * The company file (2026-10-11, rev. 3): a calm overview. Each card shows only what is
 * filled in; owners and admins open the rest with one "Add" per card, so an empty company
 * reads as a handful of invitations instead of a wall of prompts. Every number is real.
 */
export function CompanyPage({ workspace, onGo, onSettings }: { workspace: Workspace; onGo: (link: DeskLink) => void; onSettings: () => void }) {
  const canEdit = workspace.role === 'owner' || workspace.role === 'admin'
  const { profile, loading, failed, retry, save, list, error, clearError } = useCompanyProfile(workspace.id)
  const updateWorkspace = useUpdateWorkspace(workspace.id)
  const [inviting, setInviting] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string, on?: boolean) => setOpen((prev) => {
    const next = new Set(prev)
    if (on ?? !next.has(id)) next.add(id)
    else next.delete(id)
    return next
  })

  if (loading) return <p className="cp-status" role="status">Loading the company…</p>
  if (failed || !profile) {
    return (
      <p className="cp-status" role="alert">
        Couldn’t load the company profile. <button type="button" className="inline-link" onClick={retry}>Try again</button>
      </p>
    )
  }

  const p = profile
  const set = (key: keyof ProfileChanges) => (next: string | null) => save({ [key]: next } as ProfileChanges)
  const items = (key: ListField) => list(key).map((f) => ({ value: f.value, suggested: f.status === 'inferred' }))
  const has = (key: keyof CompanyProfile) => p[key] != null && p[key] !== ''
  const text = (key: keyof ProfileChanges & keyof CompanyProfile, label: string, prompt: string, max: number, multiline = false): FieldDef => ({
    key, label, filled: has(key),
    node: <InlineText value={p[key] as string | null} canEdit={canEdit} label={label} prompt={prompt} maxLength={max} multiline={multiline} onSave={set(key)} />,
  })
  const choice = (key: keyof ProfileChanges & keyof CompanyProfile, opts: Option[], label: string, prompt: string): FieldDef => ({
    key, label, filled: has(key),
    node: <InlineSelect value={p[key] as string | null} options={opts} canEdit={canEdit} label={label} prompt={prompt} onSave={set(key)} />,
  })
  const many = (key: ListField, label: string, prompt: string, extra: Partial<Parameters<typeof InlineList>[0]> = {}): FieldDef => ({
    key, label, filled: list(key).length > 0,
    node: <InlineList items={items(key)} canEdit={canEdit} label={label} prompt={prompt} addLabel="Add" onSave={(next) => save({ [key]: next } as ProfileChanges)} {...extra} />,
  })
  const linkOut = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer">{label} ↗</a>

  const facts: FieldDef[] = [
    choice('entityType', ENTITY, 'Entity type', 'Entity type'),
    {
      key: 'foundedYear', label: 'Founded', filled: p.foundedYear != null,
      node: (
        <InlineText value={p.foundedYear == null ? null : String(p.foundedYear)} canEdit={canEdit} label="Founded" prompt="Founded" maxLength={4} validate={year} onSave={(next) => save({ foundedYear: next == null ? null : Number(next) })}>
          Founded {p.foundedYear}
        </InlineText>
      ),
    },
    text('location', 'Headquarters', 'Headquarters', 200),
    choice('sizeRange', EMPLOYEES, 'Employees', 'Employees'),
    choice('revenueRange', REVENUE, 'Annual revenue', 'Annual revenue'),
    choice('businessModel', MODEL, 'Business model', 'Business model'),
  ]

  const sections: SectionDef[] = [
    {
      id: 'strategy', title: 'Mission & strategy', blurb: 'Why the company exists, where it is going, and what stands in the way.', icon: <ChartMetricsIcon />,
      fields: [
        text('mission', 'Mission statement', 'Add the mission statement', 1000, true),
        text('vision', 'Vision', 'Add the vision', 1000, true),
        text('valueProposition', 'Value proposition', 'Add the value proposition', 1000, true),
        many('goals', 'Strategic objectives', 'Add an objective'),
        many('challenges', 'Key challenges', 'Add a challenge'),
      ],
    },
    {
      id: 'market', title: 'Market', blurb: 'Who the company sells to, where, and who it competes with.', icon: <PersonIcon guest={false} />,
      fields: [
        many('customers', 'Target markets', 'Add a target market'),
        text('idealCustomer', 'Ideal customer profile', 'Describe the ideal customer', 1000, true),
        choice('serviceArea', REACH, 'Geographic reach', 'Set the reach'),
        many('competitors', 'Competitors', 'Add a competitor'),
        many('differentiators', 'Competitive advantages', 'Add an advantage'),
      ],
    },
    {
      id: 'offering', title: 'Products & services', blurb: 'What the company sells and how it charges for it.', icon: <GridViewIcon />,
      fields: [
        many('offerings', 'Offerings', 'Add a product or service'),
        choice('pricingModel', PRICING, 'Pricing model', 'Set the pricing model'),
      ],
    },
    {
      id: 'brand', title: 'Brand', blurb: 'How the company sounds, and the words it uses and avoids.', icon: <BookIcon />,
      fields: [
        choice('brandVoice', VOICE, 'Brand voice', 'Set the brand voice'),
        many('terms', 'Preferred terminology', 'Add a preferred term'),
        many('avoid', 'Terms to avoid', 'Add a term to avoid'),
      ],
    },
    {
      id: 'contact', title: 'Contact & presence', blurb: 'How customers reach the company and find it online.', icon: <SendIcon />,
      fields: [
        { ...text('email', 'Business email', 'Add the business email', 254), node: <InlineText value={p.email} canEdit={canEdit} label="Business email" prompt="Add the business email" maxLength={254} validate={email} onSave={set('email')}>{p.email && !canEdit ? <a href={`mailto:${p.email}`}>{p.email}</a> : p.email}</InlineText> },
        { ...text('phone', 'Phone', 'Add a phone number', 40), node: <InlineText value={p.phone} canEdit={canEdit} label="Phone" prompt="Add a phone number" maxLength={40} validate={phone} onSave={set('phone')}>{p.phone && !canEdit ? <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>{p.phone}</a> : p.phone}</InlineText> },
        text('hours', 'Business hours', 'Add business hours', 200),
        { ...text('website', 'Website', 'Add the website', 512), node: <InlineText value={p.website} canEdit={canEdit} label="Website" prompt="Add the website" maxLength={512} validate={webUrl} onSave={set('website')}>{p.website && (canEdit ? host(p.website) : linkOut(p.website, host(p.website)))}</InlineText> },
        many('links', 'Social profiles', 'Add a profile link', { addLabel: 'Add link', validate: webUrl, render: (v: string) => (canEdit ? host(v) : linkOut(v, host(v))) }),
      ],
    },
  ]

  // Completeness over everything the page asks for, and the next thing to add.
  const headline: FieldDef[] = [
    { key: 'purpose', label: 'Business description', filled: has('purpose'), node: null },
    { key: 'legalName', label: 'Legal name', filled: has('legalName'), node: null },
    { key: 'industry', label: 'Industry', filled: has('industry'), node: null },
  ]
  const all = [...headline, ...facts, ...sections.flatMap((s) => s.fields)]
  const done = all.filter((f) => f.filled).length
  const nextSection = sections.find((s) => s.fields.some((f) => !f.filled))
  const nextField = [...headline, ...facts].find((f) => !f.filled) ?? nextSection?.fields.find((f) => !f.filled)
  const goNext = () => {
    const target = facts.includes(nextField!) ? 'facts' : headline.includes(nextField!) ? null : nextSection?.id
    if (target) toggle(target, true)
    requestAnimationFrame(() => document.getElementById(target ? `cp-${target}` : 'cp-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  const rename = async (next: string | null) => {
    if (!next) return false
    try {
      await updateWorkspace.mutateAsync({ name: next })
    } catch {
      return false
    }
    // One name everywhere: the profile's name is what the assistant writes with.
    return save({ name: next })
  }
  const filledFacts = facts.filter((f) => f.filled)

  return (
    <article className="cp" aria-labelledby="cp-name">
      <header className="cp-hero">
        <Logo workspace={workspace} logoUrl={p.logoUrl} canEdit={canEdit} onLogo={(id) => save({ logoMediaId: id })} />
        <div className="cp-identity">
          <h1 id="cp-name" className="cp-name">
            <InlineText value={workspace.name} canEdit={canEdit} required label="Company name" prompt="Name the company" maxLength={120} onSave={rename} />
          </h1>
          <p className="cp-subline">
            <InlineText value={p.legalName} canEdit={canEdit} label="Legal name" prompt="Legal name" maxLength={200} onSave={set('legalName')} />
            <InlineText value={p.industry} canEdit={canEdit} label="Industry" prompt="Industry" maxLength={120} onSave={set('industry')} />
          </p>
          <div className="cp-description">
            <InlineText value={p.purpose} canEdit={canEdit} label="Business description" prompt="Add a one-paragraph business description" maxLength={1000} multiline onSave={set('purpose')} />
          </div>
          <div className="cp-facts" id="cp-facts">
            {open.has('facts') && canEdit ? (
              <div className="cp-facts-edit">
                {facts.map((f) => (
                  <label key={f.key} className="cp-facts-field">
                    <span>{f.label}</span>
                    {f.node}
                  </label>
                ))}
                <button type="button" className="inline-link" onClick={() => toggle('facts', false)}>Done</button>
              </div>
            ) : (
              <>
                {filledFacts.map((f) => <span key={f.key} className="cp-pill">{f.node}</span>)}
                {canEdit && (
                  <button type="button" className="cp-pill cp-pill-add" onClick={() => toggle('facts', true)}>
                    {filledFacts.length ? 'Edit company facts' : '+ Add company facts'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="cp-hero-side">
          <div className="cp-actions">
            {canEdit && <button type="button" className="cp-action" onClick={() => setInviting(true)}>Invite</button>}
            <button type="button" className="cp-action cp-gear" onClick={onSettings} aria-label="Company settings" title="Company settings">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.6 3.3.9.7-1.2 2.1-1.1-.4a4.8 4.8 0 0 1-1.4.8L10.6 13H8.2l-.2-1a4.8 4.8 0 0 1-1.4-.8l-1.1.4-1.2-2.1.9-.7a4.8 4.8 0 0 1 0-1.6l-.9-.7 1.2-2.1 1.1.4c.4-.3.9-.6 1.4-.8l.2-1h2.4l.2 1c.5.2 1 .5 1.4.8l1.1-.4 1.2 2.1-.9.7a4.8 4.8 0 0 1 0 1.6Z" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
            </button>
          </div>
          {canEdit && done < all.length && <Completeness done={done} total={all.length} next={nextField?.label} onNext={goNext} />}
        </div>
      </header>

      {error && (
        <p className="cp-error" role="alert">
          {error} <button type="button" className="inline-link" onClick={clearError}>Dismiss</button>
        </p>
      )}

      <Pulse workspace={workspace} onGo={onGo} />

      <div className="cp-cards">
        {sections.map((s) => (
          <Section key={s.id} section={s} canEdit={canEdit} open={open.has(s.id)} onToggle={(on) => toggle(s.id, on)} />
        ))}
        <TeamCard workspace={workspace} onInvite={canEdit ? () => setInviting(true) : undefined} />
      </div>

      {inviting && (
        <FormSlideout title="Invite someone" onClose={() => setInviting(false)}>
          <InviteMember workspaceId={workspace.id} onClose={() => setInviting(false)} />
        </FormSlideout>
      )}
    </article>
  )
}

/** A ring that fills as the profile does, naming the next thing to add. */
function Completeness({ done, total, next, onNext }: { done: number; total: number; next?: string; onNext: () => void }) {
  const pct = Math.round((done / total) * 100)
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="cp-complete">
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Profile ${pct}% complete`}>
        <circle cx="32" cy="32" r={r} className="cp-ring-track" />
        <circle cx="32" cy="32" r={r} className="cp-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} transform="rotate(-90 32 32)" />
        <text x="32" y="36" textAnchor="middle" className="cp-ring-text">{pct}%</text>
      </svg>
      <div>
        <p className="cp-complete-title">Profile {done} of {total}</p>
        {next && <button type="button" className="inline-link" onClick={onNext}>Next: {next.toLowerCase()}</button>}
      </div>
    </div>
  )
}

function Section({ section, canEdit, open, onToggle }: { section: SectionDef; canEdit: boolean; open: boolean; onToggle: (on: boolean) => void }) {
  const filled = section.fields.filter((f) => f.filled)
  const missing = section.fields.filter((f) => !f.filled)
  if (!filled.length && !canEdit) return null
  const shown = open ? section.fields : filled
  return (
    <section className="cp-card" id={`cp-${section.id}`} aria-labelledby={`cp-${section.id}-title`} data-empty={filled.length ? undefined : ''}>
      <header className="cp-card-head">
        <span className="cp-card-icon" aria-hidden="true">{section.icon}</span>
        <h2 id={`cp-${section.id}-title`}>{section.title}</h2>
        {canEdit && <span className="cp-card-count">{filled.length}/{section.fields.length}</span>}
      </header>
      {shown.length > 0 ? (
        <dl className="cp-fields">
          {shown.map((f) => (
            <div key={f.key} className="cp-field">
              <dt>{f.label}</dt>
              <dd>{f.node}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cp-card-blurb">{section.blurb}</p>
      )}
      {canEdit && missing.length > 0 && (
        <button type="button" className="cp-card-more" aria-expanded={open} onClick={() => onToggle(!open)}>
          {open ? 'Show less' : filled.length ? `+ Add ${missing.map((f) => f.label.toLowerCase()).slice(0, 2).join(', ')}${missing.length > 2 ? ` and ${missing.length - 2} more` : ''}` : 'Add details'}
        </button>
      )}
    </section>
  )
}

function Logo({ workspace, logoUrl, canEdit, onLogo }: { workspace: Workspace; logoUrl: string | null; canEdit: boolean; onLogo: (mediaId: string | null) => Promise<boolean> }) {
  const uploadMedia = useUploadMedia()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const initial = workspace.name.trim().charAt(0).toUpperCase() || '·'
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setProblem('')
    try {
      const media = await uploadMedia.mutateAsync({ file, type: 'image', name: file.name })
      await onLogo(media.id)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Couldn’t upload the logo.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="cp-logo-wrap">
      <div className="cp-logo">
        {logoUrl ? <img src={logoUrl} alt="" /> : <span aria-hidden="true">{initial}</span>}
        {canEdit && (
          <button type="button" className="cp-logo-edit" disabled={busy} onClick={() => input.current?.click()} aria-label={logoUrl ? 'Change logo' : 'Add a logo'}>
            {busy ? '…' : logoUrl ? 'Change' : 'Add logo'}
          </button>
        )}
        {canEdit && logoUrl && (
          <button type="button" className="cp-logo-remove" onClick={() => void onLogo(null)} aria-label="Remove logo" title="Remove logo">×</button>
        )}
      </div>
      {problem && <p className="cp-error" role="alert">{problem}</p>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

/** Stat tiles, then what needs attention and the pipeline — only when there is something to show. */
function Pulse({ workspace, onGo }: { workspace: Workspace; onGo: (link: DeskLink) => void }) {
  const insights = useWorkspaceInsights(workspace.id)
  const tasks = useTaskReport(workspace.id, 1)
  const budget = useBudgetSummary(workspace.id)
  const data = insights.data
  const card = (id: string) => data?.cards.find((c) => c.id === id)
  const attention = (data?.attention ?? []).filter((a) => a.id !== 'profile-gap')
  const open = (data?.pipeline ?? []).filter((s) => s.kind === 'open')
  const total = open.reduce((n, s) => n + s.count, 0)
  const now = tasks.data?.now
  const b = budget.data

  const tiles = useMemo(() => {
    const split = (v?: string) => {
      const [main, ...rest] = (v ?? '—').split(' · ')
      return { main, sub: rest.join(' · ') }
    }
    const customers = split(card('customers')?.value)
    const newThisWeek = customers.sub.replace('/ 7d', 'this week')
    return [
      { id: 'leads', icon: <PersonIcon guest={false} />, label: 'Open leads', value: split(card('open-leads')?.value).main, sub: '', href: card('open-leads')?.href },
      { id: 'pipeline', icon: <WorkflowIcon />, label: 'Pipeline value', value: split(card('pipeline-value')?.value).main, sub: total ? `${total} open ${total === 1 ? 'deal' : 'deals'}` : '', href: card('pipeline-value')?.href },
      { id: 'customers', icon: <BuildingIcon />, label: 'Customers', value: customers.main, sub: /^0 /.test(newThisWeek) ? '' : newThisWeek, href: card('customers')?.href },
      now
        ? { id: 'tasks', icon: <ClockIcon />, label: 'Open tasks', value: String(now.todo + now.doing), sub: now.overdue ? `${now.overdue} overdue` : now.blocked ? `${now.blocked} blocked` : '', alert: now.overdue > 0 || now.blocked > 0, href: { desk: 'tasks' } }
        : { id: 'tasks', icon: <ClockIcon />, label: 'Open tasks', value: '—', sub: '', href: { desk: 'tasks' } },
      ...(b && b.itemCount > 0
        ? [{ id: 'net', icon: <ChartMetricsIcon />, label: 'Net cashflow', value: `${b.netBalanceMinor >= 0 ? '+' : ''}${formatMinorMoney(b.netBalanceMinor, b.currency)}`, sub: '', href: { desk: 'budget' } }]
        : []),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, now, b, total])

  return (
    <>
      <section className="cp-stats" aria-label="Key figures">
        {tiles.map((t) => (
          <button key={t.id} type="button" className="cp-stat" onClick={() => t.href && onGo(t.href as DeskLink)}>
            <span className="cp-stat-icon" aria-hidden="true">{t.icon}</span>
            <span className="cp-stat-value">{insights.isLoading && t.id !== 'tasks' && t.id !== 'net' ? '…' : t.value}</span>
            <span className="cp-stat-label">{t.label}</span>
            {t.sub && <span className="cp-stat-sub" data-alert={'alert' in t && t.alert ? '' : undefined}>{t.sub}</span>}
          </button>
        ))}
      </section>

      {(attention.length > 0 || total > 0) && (
        <div className="cp-pulse">
          {attention.length > 0 && (
            <section className="cp-card cp-alert" aria-labelledby="cp-attention">
              <header className="cp-card-head">
                <span className="cp-card-icon" aria-hidden="true"><BellIcon /></span>
                <h2 id="cp-attention">Needs attention</h2>
              </header>
              <ul className="cp-list">
                {attention.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="cp-attention" onClick={() => onGo(a.href as DeskLink)}>
                      <span>{a.label}</span>
                      <span className="cp-quiet">{a.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {total > 0 && (
            <section className="cp-card" aria-labelledby="cp-pipeline">
              <header className="cp-card-head">
                <span className="cp-card-icon" aria-hidden="true"><WorkflowIcon /></span>
                <h2 id="cp-pipeline">Pipeline</h2>
                <span className="cp-card-count">{total} open</span>
              </header>
              <div className="cp-funnel" role="img" aria-label={open.map((s) => `${s.label} ${s.count}`).join(', ')}>
                {open.filter((s) => s.count > 0).map((s, i) => (
                  <span key={s.key} style={{ flexGrow: s.count, ['--step' as string]: i }} title={`${s.label}: ${s.count}`} />
                ))}
              </div>
              <ul className="cp-legend">
                {open.map((s, i) => (
                  <li key={s.key}>
                    <button type="button" onClick={() => onGo({ desk: 'contacts', params: { stage: s.key } })}>
                      <i style={{ ['--step' as string]: i }} aria-hidden="true" />
                      <span>{s.label}</span>
                      <b>{s.count}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  )
}

function TeamCard({ workspace, onInvite }: { workspace: Workspace; onInvite?: () => void }) {
  const insights = useWorkspaceInsights(workspace.id)
  const members = useWorkspaceMembers(workspace.id)
  const invites = useWorkspaceInvites(workspace.id)
  const people = (members.data ?? []).filter((m) => m.status === 'active')
  const pending = invites.isError ? 0 : (invites.data?.length ?? 0)
  const recent = (insights.data?.recent ?? []).slice(0, 5)
  return (
    <section className="cp-card" aria-labelledby="cp-team-title">
      <header className="cp-card-head">
        <span className="cp-card-icon" aria-hidden="true"><UserCardIcon /></span>
        <h2 id="cp-team-title">Team & activity</h2>
        <span className="cp-card-count">{people.length} {people.length === 1 ? 'member' : 'members'}{pending > 0 ? ` · ${pending} invited` : ''}</span>
      </header>
      <ul className="cp-faces">
        {people.slice(0, 12).map((m) => (
          <li key={m.id} title={m.user.name ?? m.email ?? ''}>
            {m.user.avatarUrl ? <img src={m.user.avatarUrl} alt="" /> : <span aria-hidden="true">{(m.user.name ?? m.email ?? '?').charAt(0).toUpperCase()}</span>}
            <span className="cp-face-name">{(m.user.name ?? m.email ?? '').split(' ')[0]}</span>
          </li>
        ))}
        {onInvite && (
          <li>
            <button type="button" className="cp-face-add" onClick={onInvite} aria-label="Invite someone">+</button>
            <span className="cp-face-name">Invite</span>
          </li>
        )}
      </ul>
      {recent.length > 0 && (
        <ul className="cp-list cp-recent">
          {recent.map((r) => (
            <li key={r.id}>
              <span className="cp-recent-title">{r.title}</span>
              <time className="cp-when" dateTime={r.at}>{formatAgo(r.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
