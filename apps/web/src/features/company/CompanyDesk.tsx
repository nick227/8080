import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { Desk } from '../work/sections'
import { CompanyPage } from './CompanyPage'
import { CompanySettings, SETTINGS_SECTIONS, type SettingsSection } from './CompanySettings'
import { applyDeskLink, type DeskLink } from './links'
import { deskPath } from '../records/navigation'
import { onCompanyPath, projectPath } from '../tasks/links'
import '../records/records.css'
import './company.css'
import { useCurrentWorkspace } from '../../app/workspace'

/** The company page, plus settings behind `?settings=` (old `?tab=` links still land). */
export function CompanyDesk({ onPlace }: { roomId?: string; onPlace?: (desk: Desk) => void; onOpenComposer?: () => void }) {
  const { workspace } = useCurrentWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('settings')
  const settings = SETTINGS_SECTIONS.some((s) => s.id === requested) ? (requested as SettingsSection) : null

  // The page used to have tabs: Integrations and Vocabulary now open settings; the rest is the page.
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (!tab) return
    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    if (tab === 'integrations' || tab === 'vocabulary') next.set('settings', tab)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const setSettings = (section: SettingsSection | null) => {
    const next = new URLSearchParams(searchParams)
    if (section) next.set('settings', section)
    else next.delete('settings')
    setSearchParams(next, { replace: !!section && !!settings })
  }

  const go = (link: DeskLink) => {
    if (onCompanyPath(location.pathname)) {
      const params = new URLSearchParams(Object.entries(link.params ?? {}).filter(([, v]) => v))
      navigate({ pathname: deskPath(projectPath(location.pathname), link.desk as Desk), search: params.toString() })
      return
    }
    applyDeskLink(link, (desk) => onPlace?.(desk), (params) => {
      navigate({ pathname: location.pathname, search: params.toString() })
    })
  }

  if (!workspace) {
    return <p className="work-empty">Join or create a company to see its page.</p>
  }

  return (
    <div className="company">
      <CompanyPage workspace={workspace} onGo={go} onSettings={() => setSettings('general')} />
      {settings && <CompanySettings workspace={workspace} section={settings} onSection={setSettings} onClose={() => setSettings(null)} />}
    </div>
  )
}
