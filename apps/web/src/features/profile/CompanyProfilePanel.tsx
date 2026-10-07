import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, getApiClient, unwrap } from '@project/sdk'
import './profile.css'

// Edit company profile: ordinary fields, saved together (PATCH …/company-profile).
// What is saved here is final — documents are written from it, and the setup's
// reading never replaces it. No conversation, no proposals.

type Profile = {
  revision: number; name: string | null; location: string | null; serviceArea: string | null; purpose: string | null; brandVoice: string | null
  facts: { kind: string; value: string }[]
}
type Form = { name: string; purpose: string; location: string; serviceArea: string; brandVoice: string; offerings: string; customers: string; differentiators: string }
const LISTS = { offerings: 'offering', customers: 'customer', differentiators: 'differentiator' } as const
const split = (text: string) => text.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean)

function formOf(p: Profile): Form {
  const list = (kind: string) => p.facts.filter((f) => f.kind === kind).map((f) => f.value).join(', ')
  return {
    name: p.name ?? '', purpose: p.purpose ?? '', location: p.location ?? '', serviceArea: p.serviceArea ?? '', brandVoice: p.brandVoice ?? '',
    offerings: list('offering'), customers: list('customer'), differentiators: list('differentiator'),
  }
}

export function CompanyProfilePanel({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const key = ['company-profile', workspaceId]
  const profile = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/company-profile', { params: { path: { workspaceId } } })).data as Profile,
  })
  const [form, setForm] = useState<Form | null>(null)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (profile.data && !form) setForm(formOf(profile.data)) }, [profile.data, form])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!form || !profile.data) return
    const was = formOf(profile.data)
    const changes: Record<string, unknown> = {}
    for (const field of ['name', 'purpose', 'location', 'serviceArea', 'brandVoice'] as const) if (form[field] !== was[field]) changes[field] = form[field].trim() || null
    for (const field of Object.keys(LISTS) as (keyof typeof LISTS)[]) if (split(form[field]).join('|') !== split(was[field]).join('|')) changes[field] = split(form[field])
    if (!Object.keys(changes).length) { setStatus('No changes.'); return }
    setSaving(true)
    setStatus('Saving…')
    try {
      const saved = unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/company-profile', { params: { path: { workspaceId } }, body: { expectedRevision: profile.data.revision, changes: changes as never } })).data as Profile
      queryClient.setQueryData(key, saved)
      setForm(formOf(saved))
      setStatus('Saved.')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PROFILE_REVISION_CONFLICT') {
        await profile.refetch()
        setForm(null)
        setStatus('The profile was changed elsewhere and has been reloaded. Make your edit again.')
      } else if (error instanceof ApiError && error.status === 403) {
        setStatus('Only workspace owners and admins can edit the company profile.')
      } else setStatus(error instanceof Error ? error.message : 'Couldn’t save.')
    } finally {
      setSaving(false)
    }
  }

  const field = (name: keyof Form, label: string, props: { area?: boolean; hint?: string } = {}) => (
    <label className="profile-field">
      <span>{label}</span>
      {props.area
        ? <textarea rows={3} value={form?.[name] ?? ''} onChange={(e) => setForm((f) => f && { ...f, [name]: e.target.value })} />
        : <input value={form?.[name] ?? ''} onChange={(e) => setForm((f) => f && { ...f, [name]: e.target.value })} />}
      {props.hint && <small>{props.hint}</small>}
    </label>
  )
  const select = (name: 'serviceArea' | 'brandVoice', label: string, options: [string, string][]) => (
    <label className="profile-field">
      <span>{label}</span>
      <select value={form?.[name] ?? ''} onChange={(e) => setForm((f) => f && { ...f, [name]: e.target.value })}>
        <option value="">Not set</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )

  return (
    <div className="profile-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="profile-panel" aria-label="Edit company profile" onSubmit={(e) => void save(e)}>
        <header>
          <h2>Edit company profile</h2>
          <button type="button" className="profile-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {!form ? <p role="status">{profile.isError ? 'Couldn’t load the company profile.' : 'Loading…'}</p> : (
          <>
            {field('name', 'Company name')}
            {field('purpose', 'What the business does', { area: true })}
            {field('location', 'Location')}
            {select('serviceArea', 'Where it works', [['local', 'Local'], ['regional', 'Regional'], ['national', 'National'], ['global', 'Global']])}
            {field('offerings', 'Products and services', { hint: 'Separate with commas.' })}
            {field('customers', 'Customers', { hint: 'Separate with commas.' })}
            {field('differentiators', 'What sets it apart', { hint: 'Separate with commas.' })}
            {select('brandVoice', 'Tone for documents', [['professional', 'Professional'], ['friendly', 'Friendly'], ['bold', 'Bold'], ['technical', 'Technical']])}
            <footer>
              <span role="status">{status}</span>
              <button type="submit" className="profile-save" disabled={saving}>Save</button>
            </footer>
          </>
        )}
      </form>
    </div>
  )
}
