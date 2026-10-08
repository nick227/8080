import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, getApiClient, unwrap } from '@project/sdk'
import { SectionHeader } from '../work/SectionHeader'

type Profile = {
  revision: number
  name: string | null
  location: string | null
  serviceArea: string | null
  purpose: string | null
  brandVoice: string | null
  facts: { kind: string; value: string }[]
}
type Form = {
  name: string
  purpose: string
  location: string
  serviceArea: string
  brandVoice: string
  offerings: string
  customers: string
  differentiators: string
}
const LISTS = { offerings: 'offering', customers: 'customer', differentiators: 'differentiator' } as const
const split = (text: string) => text.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean)

function formOf(p: Profile): Form {
  const list = (kind: string) => p.facts.filter((f) => f.kind === kind).map((f) => f.value).join(', ')
  return {
    name: p.name ?? '',
    purpose: p.purpose ?? '',
    location: p.location ?? '',
    serviceArea: p.serviceArea ?? '',
    brandVoice: p.brandVoice ?? '',
    offerings: list('offering'),
    customers: list('customer'),
    differentiators: list('differentiator'),
  }
}

export function CompanyProfileSection({
  workspaceId,
  canEdit,
  onOpenChannel,
}: {
  workspaceId: string
  canEdit: boolean
  onOpenChannel?: () => void
}) {
  const queryClient = useQueryClient()
  const key = ['company-profile', workspaceId]
  const profile = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/company-profile', { params: { path: { workspaceId } } })).data as Profile,
  })
  const [form, setForm] = useState<Form | null>(null)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (profile.data) setForm(formOf(profile.data))
  }, [profile.data])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!form || !profile.data || !canEdit) return
    const was = formOf(profile.data)
    const changes: Record<string, unknown> = {}
    for (const field of ['name', 'purpose', 'location', 'serviceArea', 'brandVoice'] as const) {
      if (form[field] !== was[field]) changes[field] = form[field].trim() || null
    }
    for (const field of Object.keys(LISTS) as (keyof typeof LISTS)[]) {
      if (split(form[field]).join('|') !== split(was[field]).join('|')) changes[field] = split(form[field])
    }
    if (!Object.keys(changes).length) {
      setStatus('No changes.')
      return
    }
    setSaving(true)
    setStatus('Saving…')
    try {
      const saved = unwrap(
        await getApiClient().PATCH('/workspaces/{workspaceId}/company-profile', {
          params: { path: { workspaceId } },
          body: { expectedRevision: profile.data.revision, changes: changes as never },
        }),
      ).data as Profile
      queryClient.setQueryData(key, saved)
      void queryClient.invalidateQueries({ queryKey: ['workspace-insights', workspaceId] })
      setForm(formOf(saved))
      setStatus('Saved.')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PROFILE_REVISION_CONFLICT') {
        await profile.refetch()
        setStatus('The profile was changed elsewhere and has been reloaded.')
      } else if (error instanceof ApiError && error.status === 403) {
        setStatus('Only owners and admins can edit the company profile.')
      } else setStatus(error instanceof Error ? error.message : 'Couldn’t save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="company-group" aria-labelledby="company-profile-title">
      <SectionHeader title="Profile" titleId="company-profile-title">
        {onOpenChannel && (
          <button type="button" className="section-add-btn" onClick={onOpenChannel}>
            Setup with chatbot
          </button>
        )}
      </SectionHeader>
      {!form ? (
        <p className="company-status" role="status">
          {profile.isError ? 'Couldn’t load the company profile.' : 'Loading…'}
        </p>
      ) : (
        <form className="company-form" onSubmit={(e) => void save(e)}>
          <div className="record-form-fields">
            <label>
              <span>Company name</span>
              <input value={form.name} disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              <span>What the business does</span>
              <textarea rows={3} value={form.purpose} disabled={!canEdit} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
            </label>
            <label>
              <span>Location</span>
              <input value={form.location} disabled={!canEdit} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
            <label>
              <span>Where it works</span>
              <select value={form.serviceArea} disabled={!canEdit} onChange={(e) => setForm({ ...form, serviceArea: e.target.value })}>
                <option value="">Not set</option>
                <option value="local">Local</option>
                <option value="regional">Regional</option>
                <option value="national">National</option>
                <option value="global">Global</option>
              </select>
            </label>
            <label>
              <span>Products and services</span>
              <input value={form.offerings} disabled={!canEdit} onChange={(e) => setForm({ ...form, offerings: e.target.value })} placeholder="Separate with commas" />
            </label>
            <label>
              <span>Customers</span>
              <input value={form.customers} disabled={!canEdit} onChange={(e) => setForm({ ...form, customers: e.target.value })} placeholder="Separate with commas" />
            </label>
            <label>
              <span>What sets it apart</span>
              <input value={form.differentiators} disabled={!canEdit} onChange={(e) => setForm({ ...form, differentiators: e.target.value })} placeholder="Separate with commas" />
            </label>
            <label>
              <span>Tone for documents</span>
              <select value={form.brandVoice} disabled={!canEdit} onChange={(e) => setForm({ ...form, brandVoice: e.target.value })}>
                <option value="">Not set</option>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="bold">Bold</option>
                <option value="technical">Technical</option>
              </select>
            </label>
          </div>
          {canEdit && (
            <footer>
              <span role="status">{status}</span>
              <button type="submit" className="record-primary" disabled={saving}>
                Save
              </button>
            </footer>
          )}
        </form>
      )}
    </section>
  )
}
