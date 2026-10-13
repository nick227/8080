import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMyWorkspaces } from '@project/sdk'
import { chooseWorkspace, useCreateCompany, useCurrentWorkspace } from '../../app/workspace'
import { ChevronIcon } from '../../components/icons'
import { useCompanyProfile } from '../company/useCompanyProfile'

/** The company mark: its logo, else its initial. */
function CompanyMark({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [logoUrl])
  return (
    <span className={`ws-mark${logoUrl && !broken ? ' has-image' : ''}`} aria-hidden>
      {logoUrl && !broken ? <img src={logoUrl} alt="" onError={() => setBroken(true)} /> : name.trim().charAt(0).toUpperCase() || '·'}
    </span>
  )
}

/**
 * The header's workspace switcher (D10): current company mark + name; opens the list of
 * your companies. Choosing one remembers it (D1) and opens its page. Registered members only.
 */
export function WorkspaceSwitcher() {
  const { workspace, guest } = useCurrentWorkspace()
  const list = useMyWorkspaces().data ?? []
  const { profile } = useCompanyProfile(workspace?.id)
  const { create, creating, createError } = useCreateCompany()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (guest || !workspace) return null
  const name = profile?.name || workspace.name

  return (
    <div className="ws-switcher" ref={ref}>
      <button
        type="button"
        className="ws-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${name}. Switch workspace`}
        title={name}
        onClick={() => setOpen((v) => !v)}
      >
        <CompanyMark name={name} logoUrl={profile?.logoUrl} />
        <span className="ws-name">{name}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="ws-menu" role="menu" aria-label="Workspaces">
          {list.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitemradio"
              aria-checked={w.id === workspace.id}
              className="ws-option"
              onClick={() => {
                setOpen(false)
                chooseWorkspace(w.id)
                navigate(`/c/${w.id}`)
              }}
            >
              <CompanyMark name={w.name} logoUrl={w.id === workspace.id ? profile?.logoUrl : null} />
              <span className="ws-option-name">{w.id === workspace.id ? name : w.name}</span>
              <span className="ws-option-role">{w.role === 'owner' ? 'Owner' : w.role === 'admin' ? 'Admin' : 'Member'}</span>
            </button>
          ))}
          <div className="ws-menu-foot">
            <Link role="menuitem" to="/workspaces" onClick={() => setOpen(false)}>All workspaces</Link>
            <button type="button" role="menuitem" disabled={creating} onClick={create}>{creating ? 'Creating…' : 'Create a company'}</button>
          </div>
          {createError && <p className="ws-error" role="alert">{createError}</p>}
        </div>
      )}
    </div>
  )
}
