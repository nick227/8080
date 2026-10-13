import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useUpdateWorkspace } from '@project/sdk'
import { IntegrationsSection } from './IntegrationsSection'
import { VocabularySection } from './VocabularySection'
import './companySettings.css'

export type SettingsSection = 'general' | 'vocabulary' | 'integrations'
export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'vocabulary', label: 'Vocabulary' },
  { id: 'integrations', label: 'Integrations' },
]

type Workspace = { id: string; name: string; slug: string; timezone: string; defaultCurrency: string; role: string }

/** Company settings modal: styled after PeopleDialog. */
export function CompanySettings({ workspace, section, onSection, onClose }: {
  workspace: Workspace
  section: SettingsSection
  onSection: (section: SettingsSection) => void
  onClose: () => void
}) {
  const canEdit = workspace.role === 'owner' || workspace.role === 'admin'
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = dialog.current
    node?.showModal()
    return () => {
      node?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className={`people-dialog cp-settings-dialog cp-settings-dialog-${section}`}
      style={{ width: 'min(880px, calc(100vw - 32px))', maxWidth: '880px' }}
      aria-labelledby="cp-settings-title"
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <header className="people-dialog-head cp-settings-head">
        <div>
          <h2 id="cp-settings-title">Workspace settings</h2>
          <p>Preferences, custom vocabulary and connected integrations for {workspace.name}.</p>
        </div>
        <button type="button" className="people-dialog-close" onClick={onClose} aria-label="Close settings">✕</button>
      </header>
      <nav className="cp-settings-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`cp-settings-tab${section === s.id ? ' active' : ''}`}
            aria-current={section === s.id ? 'page' : undefined}
            onClick={() => onSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="people-dialog-body cp-settings-body">
        {section === 'general' && <General workspace={workspace} canEdit={canEdit} />}
        {section === 'vocabulary' && <VocabularySection workspaceId={workspace.id} canEdit={canEdit} inSlideout />}
        {section === 'integrations' && <IntegrationsSection workspaceId={workspace.id} canEdit={canEdit} variant="settings" />}
      </div>
    </dialog>
  )
}

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
})()

function General({ workspace, canEdit }: { workspace: Workspace; canEdit: boolean }) {
  const update = useUpdateWorkspace(workspace.id)
  const [slug, setSlug] = useState(workspace.slug)
  const [timezone, setTimezone] = useState(workspace.timezone)
  const [currency, setCurrency] = useState(workspace.defaultCurrency)
  const [status, setStatus] = useState('')
  const changed = slug !== workspace.slug || timezone !== workspace.timezone || currency !== workspace.defaultCurrency

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!changed) return
    setStatus('Saving…')
    try {
      await update.mutateAsync({
        ...(slug !== workspace.slug ? { slug } : {}),
        ...(timezone !== workspace.timezone ? { timezone } : {}),
        ...(currency !== workspace.defaultCurrency ? { defaultCurrency: currency } : {}),
      })
      setStatus('Saved.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Couldn’t save.')
    }
  }

  return (
    <form className="cp-general" onSubmit={(e) => void submit(e)}>
      <section className="people-section">
        <label className="cp-general-field">
          <span className="cp-general-label">Address</span>
          <input
            value={slug}
            disabled={!canEdit}
            pattern="[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?"
            maxLength={60}
            onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setStatus('') }}
          />
          <small className="people-muted">Lowercase letters, numbers and dashes. Used in links to the company.</small>
        </label>
      </section>

      <section className="people-section">
        <label className="cp-general-field">
          <span className="cp-general-label">Time zone</span>
          <select
            value={timezone}
            disabled={!canEdit}
            onChange={(e) => { setTimezone(e.target.value); setStatus('') }}
          >
            {(ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES]).map((z) => (
              <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <small className="people-muted">Due dates, reminders and reports follow this time zone.</small>
        </label>
      </section>

      <section className="people-section">
        <label className="cp-general-field">
          <span className="cp-general-label">Currency</span>
          <input
            value={currency}
            disabled={!canEdit}
            maxLength={3}
            pattern="[A-Z]{3}"
            onChange={(e) => { setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); setStatus('') }}
          />
          <small className="people-muted">Three-letter code, e.g. USD. New prices and budget items use it.</small>
        </label>
      </section>

      {canEdit ? (
        <footer className="cp-general-footer">
          <span className="people-muted" role="status">{status}</span>
          <button type="submit" className="people-btn people-btn-primary" disabled={!changed || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      ) : (
        <p className="people-muted">Only owners and admins can change these.</p>
      )}
    </form>
  )
}
