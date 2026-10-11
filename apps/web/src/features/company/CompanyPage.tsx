import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useBudgetSummary,
  useRecordImages,
  useSetRecordImagePrimary,
  useTaskReport,
  useUpdateWorkspace,
  useUploadMedia,
  useUploadRecordImage,
  useWorkspaceInsights,
  useWorkspaceInvites,
  useWorkspaceMembers,
} from '@project/sdk'
import { formatMinorMoney } from '@project/shared'
import { RecordGallery } from '../records/RecordGallery'
import { FormSlideout } from '../work/FormSlideout'
import { InviteMember } from '../team/InviteMember'
import { formatAgo } from '../../utils/time'
import { InlineList, InlineSelect, InlineText } from './Inline'
import { useCompanyProfile, type ListField, type ProfileChanges } from './useCompanyProfile'
import type { DeskLink } from './links'
import './company-page.css'

type Workspace = { id: string; name: string; role: string; createdAt: string; defaultCurrency?: string | null }

const AREAS = [
  { value: 'local', label: 'Local' },
  { value: 'regional', label: 'Regional' },
  { value: 'national', label: 'National' },
  { value: 'global', label: 'Global' },
]
const VOICES = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'bold', label: 'Bold' },
  { value: 'technical', label: 'Technical' },
]
const SIZES = ['1', '2-10', '11-50', '51-200', '201-1000', '1000+'].map((value) => ({
  value,
  label: value === '1' ? 'Just me' : `${value.replace('-', '–')} people`,
}))

const webUrl = (v: string) => {
  try {
    const url = new URL(v)
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? null : 'Use a full address starting with https://'
  } catch {
    return 'Use a full address starting with https://'
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

/**
 * The company page (2026-10-11 redesign): who the company is, as a profile people read
 * and admins edit in place, beside what needs attention now. No tabs; settings live
 * behind ⚙. Every number comes from the server; nothing is decorative.
 */
export function CompanyPage({ workspace, onGo, onSettings }: { workspace: Workspace; onGo: (link: DeskLink) => void; onSettings: () => void }) {
  const canEdit = workspace.role === 'owner' || workspace.role === 'admin'
  const { profile, loading, failed, retry, save, list, error, clearError } = useCompanyProfile(workspace.id)
  const updateWorkspace = useUpdateWorkspace(workspace.id)
  const images = useRecordImages(workspace.id, 'company', workspace.id)
  const [inviting, setInviting] = useState(false)

  if (loading) return <p className="cp-status" role="status">Loading the company…</p>
  if (failed || !profile) {
    return (
      <p className="cp-status" role="alert">
        Couldn’t load the company profile. <button type="button" className="inline-link" onClick={retry}>Try again</button>
      </p>
    )
  }

  const field = (key: keyof ProfileChanges) => (next: string | number | null) => save({ [key]: next } as ProfileChanges)
  const listOf = (key: ListField) => list(key).map((f) => ({ value: f.value, suggested: f.status === 'inferred' }))
  const saveList = (key: ListField) => (next: string[]) => save({ [key]: next } as ProfileChanges)
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

  return (
    <article className="cp" aria-labelledby="cp-name">
      <Masthead
        workspace={workspace}
        logoUrl={profile.logoUrl}
        coverUrl={profile.imageUrl}
        canEdit={canEdit}
        onLogo={(mediaId) => save({ logoMediaId: mediaId })}
      >
        <h1 id="cp-name" className="cp-name">
          <InlineText value={workspace.name} canEdit={canEdit} required label="Company name" prompt="Name the company" maxLength={120} onSave={rename} />
        </h1>
        <div className="cp-lede">
          <InlineText value={profile.purpose} canEdit={canEdit} multiline maxLength={1000} label="What the company does" prompt="Add a line about what the company does" onSave={field('purpose')} />
        </div>
        <p className="cp-meta">
          <InlineText value={profile.industry} canEdit={canEdit} label="Industry" prompt="Industry" maxLength={120} onSave={field('industry')} />
          <InlineText value={profile.location} canEdit={canEdit} label="Location" prompt="Location" maxLength={200} onSave={field('location')} />
          <InlineSelect value={profile.serviceArea} options={AREAS} canEdit={canEdit} label="Where it works" prompt="Reach" onSave={field('serviceArea')} />
          <InlineSelect value={profile.sizeRange} options={SIZES} canEdit={canEdit} label="Company size" prompt="Size" onSave={field('sizeRange')} />
          <InlineText
            value={profile.foundedYear == null ? null : String(profile.foundedYear)}
            canEdit={canEdit}
            label="Founded"
            prompt="Founded"
            maxLength={4}
            validate={year}
            onSave={(next) => save({ foundedYear: next == null ? null : Number(next) })}
          >
            Founded {profile.foundedYear}
          </InlineText>
          <InlineText value={profile.website} canEdit={canEdit} label="Website" prompt="Website" maxLength={512} validate={webUrl} onSave={field('website')}>
            {profile.website && (canEdit ? host(profile.website) : <a href={profile.website} target="_blank" rel="noreferrer">{host(profile.website)} ↗</a>)}
          </InlineText>
        </p>
        <div className="cp-actions">
          {canEdit && <button type="button" className="cp-action" onClick={() => setInviting(true)}>Invite</button>}
          <button type="button" className="cp-action cp-gear" onClick={onSettings} aria-label="Company settings" title="Company settings">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.6 3.3.9.7-1.2 2.1-1.1-.4a4.8 4.8 0 0 1-1.4.8L10.6 13H8.2l-.2-1a4.8 4.8 0 0 1-1.4-.8l-1.1.4-1.2-2.1.9-.7a4.8 4.8 0 0 1 0-1.6l-.9-.7 1.2-2.1 1.1.4c.4-.3.9-.6 1.4-.8l.2-1h2.4l.2 1c.5.2 1 .5 1.4.8l1.1-.4 1.2 2.1-.9.7a4.8 4.8 0 0 1 0 1.6Z" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
          </button>
        </div>
      </Masthead>

      {error && (
        <p className="cp-error" role="alert">
          {error} <button type="button" className="inline-link" onClick={clearError}>Dismiss</button>
        </p>
      )}

      <div className="cp-body">
        <section className="cp-about" aria-label="About">
          <dl className="cp-entry">
            <Row term="Offers">
              <InlineList items={listOf('offerings')} canEdit={canEdit} label="What the company offers" prompt="Add what you offer" addLabel="Add" onSave={saveList('offerings')} />
            </Row>
            <Row term="Serves">
              <InlineList items={listOf('customers')} canEdit={canEdit} label="Who the company serves" prompt="Add who you serve" addLabel="Add" onSave={saveList('customers')} />
            </Row>
            <Row term="Edge">
              <InlineList items={listOf('differentiators')} canEdit={canEdit} label="What sets the company apart" prompt="Add what sets you apart" addLabel="Add" onSave={saveList('differentiators')} />
            </Row>
            <Row term="Goals">
              <InlineList items={listOf('goals')} canEdit={canEdit} label="Goals" prompt="Add a goal" addLabel="Add" onSave={saveList('goals')} />
            </Row>
            <Row term="Voice">
              <InlineSelect value={profile.brandVoice} options={VOICES} canEdit={canEdit} label="Voice" prompt="Choose how the company sounds" onSave={field('brandVoice')} />
            </Row>
            <Row term="Legal name">
              <InlineText value={profile.legalName} canEdit={canEdit} label="Legal name" prompt="Add the legal or trading name" maxLength={200} onSave={field('legalName')} />
            </Row>
            <Row term="Elsewhere">
              <InlineList
                items={listOf('links')}
                canEdit={canEdit}
                label="Links"
                prompt="Add a social profile or listing"
                addLabel="Add link"
                validate={webUrl}
                render={(v) => (canEdit ? host(v) : <a href={v} target="_blank" rel="noreferrer">{host(v)} ↗</a>)}
                onSave={saveList('links')}
              />
            </Row>
          </dl>
          {(canEdit || (images.data?.length ?? 0) > 0) && (
            <div className="cp-gallery">
              <RecordGallery workspaceId={workspace.id} kind="company" recordId={workspace.id} name={workspace.name} />
            </div>
          )}
        </section>

        <Now workspace={workspace} onGo={onGo} onInvite={canEdit ? () => setInviting(true) : undefined} />
      </div>

      {inviting && (
        <FormSlideout title="Invite someone" onClose={() => setInviting(false)}>
          <InviteMember workspaceId={workspace.id} onClose={() => setInviting(false)} />
        </FormSlideout>
      )}
    </article>
  )
}

/** A dl row that hides itself when its value renders nothing (read-only + empty). */
function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="cp-row">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Masthead({ workspace, logoUrl, coverUrl, canEdit, onLogo, children }: {
  workspace: Workspace
  logoUrl: string | null
  coverUrl: string | null
  canEdit: boolean
  onLogo: (mediaId: string | null) => Promise<boolean>
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const uploadMedia = useUploadMedia()
  const uploadCover = useUploadRecordImage(workspace.id, 'company', workspace.id)
  const setPrimary = useSetRecordImagePrimary(workspace.id, 'company', workspace.id)
  const logoInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'' | 'logo' | 'cover'>('')
  const [problem, setProblem] = useState('')
  const initial = workspace.name.trim().charAt(0).toUpperCase() || '·'

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    setBusy('logo'); setProblem('')
    try {
      const media = await uploadMedia.mutateAsync({ file, type: 'image', name: file.name })
      await onLogo(media.id)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Couldn’t upload the logo.')
    } finally {
      setBusy('')
    }
  }
  const pickCover = async (file: File | undefined) => {
    if (!file) return
    setBusy('cover'); setProblem('')
    try {
      const image = (await uploadCover.mutateAsync(file)) as { id: string; isPrimary?: boolean }
      if (!image.isPrimary) await setPrimary.mutateAsync(image.id)
      void queryClient.invalidateQueries({ queryKey: ['company-profile', workspace.id] })
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Couldn’t upload the cover.')
    } finally {
      setBusy('')
    }
  }

  return (
    <header className="cp-masthead" data-cover={coverUrl ? '' : undefined} data-band={coverUrl || canEdit ? '' : undefined}>
      {(coverUrl || canEdit) && (
        <div className="cp-cover" style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined}>
          {canEdit && (
            <button type="button" className="cp-cover-edit" disabled={busy === 'cover'} onClick={() => coverInput.current?.click()}>
              {busy === 'cover' ? 'Uploading…' : coverUrl ? 'Change cover' : 'Add a cover photo'}
            </button>
          )}
        </div>
      )}
      <div className="cp-identity">
        <div className="cp-logo">
          {logoUrl ? <img src={logoUrl} alt="" /> : <span aria-hidden="true">{initial}</span>}
          {canEdit && (
            <button type="button" className="cp-logo-edit" disabled={busy === 'logo'} onClick={() => logoInput.current?.click()} aria-label={logoUrl ? 'Change logo' : 'Add a logo'}>
              {busy === 'logo' ? '…' : logoUrl ? 'Change' : 'Add logo'}
            </button>
          )}
          {canEdit && logoUrl && (
            <button type="button" className="cp-logo-remove" onClick={() => void onLogo(null)} aria-label="Remove logo" title="Remove logo">×</button>
          )}
        </div>
        <div className="cp-heading">{children}</div>
      </div>
      {problem && <p className="cp-error" role="alert">{problem}</p>}
      <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void pickCover(e.target.files?.[0]); e.target.value = '' }} />
    </header>
  )
}

/** What needs attention now, and the numbers behind the company. */
function Now({ workspace, onGo, onInvite }: { workspace: Workspace; onGo: (link: DeskLink) => void; onInvite?: () => void }) {
  const insights = useWorkspaceInsights(workspace.id)
  const members = useWorkspaceMembers(workspace.id)
  const invites = useWorkspaceInvites(workspace.id)
  const tasks = useTaskReport(workspace.id, 1)
  const budget = useBudgetSummary(workspace.id)
  const data = insights.data
  const attention = (data?.attention ?? []).filter((a) => a.id !== 'profile-gap')
  const open = (data?.pipeline ?? []).filter((s) => s.kind === 'open')
  // An empty pipeline is a row of zeros: say nothing until there's something in it.
  const stages = open.some((s) => s.count > 0) ? open : []
  const top = Math.max(1, ...stages.map((s) => s.count))
  const people = (members.data ?? []).filter((m) => m.status === 'active')
  const pending = invites.isError ? 0 : (invites.data?.length ?? 0)
  const now = tasks.data?.now

  const numbers = useMemo(() => {
    const rows: { id: string; label: string; value: string; href?: DeskLink }[] = (data?.cards ?? []).map((c) => ({ id: c.id, label: c.label, value: c.value, href: c.href as DeskLink | undefined }))
    if (now) {
      rows.push({ id: 'tasks-open', label: 'Open tasks', value: String(now.todo + now.doing), href: { desk: 'tasks' } as DeskLink })
      rows.push({ id: 'tasks-overdue', label: 'Overdue tasks', value: String(now.overdue), href: { desk: 'tasks', params: { attention: 'overdue' } } as DeskLink })
      rows.push({ id: 'tasks-blocked', label: 'Blocked tasks', value: String(now.blocked), href: { desk: 'tasks', params: { attention: 'blocked' } } as DeskLink })
    }
    const b = budget.data
    if (b && b.itemCount > 0) {
      rows.push({ id: 'net', label: 'Net cashflow', value: `${b.netBalanceMinor >= 0 ? '+' : ''}${formatMinorMoney(b.netBalanceMinor, b.currency)}`, href: { desk: 'budget' } as DeskLink })
    }
    return rows
  }, [data?.cards, now, budget.data])

  return (
    <aside className="cp-now" aria-label="Now">
      <section className="cp-block" aria-labelledby="cp-attention">
        <h2 id="cp-attention" className="cp-label">Needs attention</h2>
        {insights.isLoading ? (
          <p className="cp-quiet">Loading…</p>
        ) : attention.length ? (
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
        ) : (
          <p className="cp-quiet">Nothing needs attention.</p>
        )}
      </section>

      {stages.length > 0 && (
        <section className="cp-block" aria-labelledby="cp-pipeline">
          <h2 id="cp-pipeline" className="cp-label">Pipeline</h2>
          <ul className="cp-stages">
            {stages.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => onGo({ desk: 'contacts', params: { stage: s.key } } as DeskLink)}>
                  <span className="cp-stage-name">{s.label}</span>
                  <span className="cp-stage-bar" aria-hidden="true"><span style={{ width: `${(s.count / top) * 100}%` }} /></span>
                  <span className="cp-stage-count">{s.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cp-block" aria-labelledby="cp-numbers">
        <h2 id="cp-numbers" className="cp-label">Numbers</h2>
        <dl className="cp-numbers">
          {numbers.map((n) => (
            <div key={n.id}>
              <dt>{n.href ? <button type="button" onClick={() => onGo(n.href!)}>{n.label}</button> : n.label}</dt>
              <dd>{n.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="cp-block" aria-labelledby="cp-team">
        <h2 id="cp-team" className="cp-label">Team</h2>
        <div className="cp-team">
          <ul className="cp-faces" aria-label={`${people.length} ${people.length === 1 ? 'member' : 'members'}`}>
            {people.slice(0, 8).map((m) => (
              <li key={m.id} title={m.user.name ?? m.email ?? ''}>
                {m.user.avatarUrl ? <img src={m.user.avatarUrl} alt="" /> : <span aria-hidden="true">{(m.user.name ?? m.email ?? '?').charAt(0).toUpperCase()}</span>}
              </li>
            ))}
          </ul>
          <p className="cp-quiet">
            {people.length} {people.length === 1 ? 'member' : 'members'}
            {pending > 0 && ` · ${pending} invited`}
            {onInvite && <> · <button type="button" className="inline-link" onClick={onInvite}>Invite</button></>}
          </p>
        </div>
      </section>

      {(data?.recent.length ?? 0) > 0 && (
        <section className="cp-block" aria-labelledby="cp-recent">
          <h2 id="cp-recent" className="cp-label">Recent</h2>
          <ul className="cp-list cp-recent">
            {data!.recent.map((r) => (
              <li key={r.id}>
                <span className="cp-recent-title">{r.title}</span>
                {r.summary && <span className="cp-quiet">{r.summary}</span>}
                <time className="cp-when" dateTime={r.at}>{formatAgo(r.at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
